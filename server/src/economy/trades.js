import { createHash, randomBytes } from 'node:crypto';
import { transaction } from '../db.js';
import { effective, rarityDefaults } from './catalog.js';
import { BURN, EconomyError, post, userOwner } from './ledger.js';
import { gameDay, getSetting } from './settings.js';

export const TRADE_TTL_MS = 72 * 3600 * 1000;
export const MAX_TRADE_ITEMS = 20;
const DAY_MS = 24 * 3600 * 1000;

/** Normalizes one side of a trade: {pwc, cards:[{uid, qty}]} with merged, sorted cards. */
export function normalizeSide(side) {
  const pwc = side?.pwc ?? 0;
  if (!Number.isSafeInteger(pwc) || pwc < 0 || pwc > 1_000_000) return null;
  const merged = new Map();
  for (const c of side?.cards || []) {
    if (!c || typeof c.uid !== 'string' || !c.uid || c.uid.length > 160 || !Number.isInteger(c.qty) || c.qty < 1 || c.qty > 60) return null;
    merged.set(c.uid, (merged.get(c.uid) || 0) + c.qty);
  }
  if (merged.size > MAX_TRADE_ITEMS) return null;
  return { pwc, cards: [...merged].sort(([a], [b]) => a.localeCompare(b)).map(([uid, qty]) => ({ uid, qty })) };
}

export function contentHash(trade) {
  const canonical = JSON.stringify([trade.public_id, trade.from_user, trade.to_user, JSON.parse(trade.offer), JSON.parse(trade.request)]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Estimated value of a side in credits: shop price of the cards plus PwnCoins at the conversion rate. */
export function sideValue(db, side, defaults = rarityDefaults(db)) {
  let value = side.pwc * getSetting(db, 'economy.pwc_to_cr');
  for (const c of side.cards) {
    const row = db.prepare('SELECT * FROM card_catalog WHERE uid = ?').get(c.uid);
    if (row) value += effective(row, defaults).price * c.qty;
  }
  return value;
}

/** Why a user cannot trade now ('' = can): status, manual lock, new account (days and finished matches). */
export function tradeBlock(db, user, now = Date.now()) {
  if (user.status !== 'active') return 'trade_locked';
  if (user.trade_locked_until !== null && user.trade_locked_until > now) return 'trade_locked';
  if (now - user.created_at < getSetting(db, 'trade.new_account_days') * DAY_MS) return 'trade_locked';
  const matches = db.prepare("SELECT COUNT(*) AS n FROM match_results WHERE status = 'consenso' AND (p0_user = ? OR p1_user = ?)").get(user.id, user.id).n;
  if (matches < getSetting(db, 'trade.new_account_matches')) return 'trade_locked';
  return '';
}

function checkCards(db, side) {
  for (const c of side.cards) {
    const row = db.prepare('SELECT tradeable, orphan FROM card_catalog WHERE uid = ?').get(c.uid);
    if (!row || row.orphan) throw new EconomyError('not_found', 404, { uid: c.uid });
    if (!row.tradeable) throw new EconomyError('not_tradeable', 409, { uid: c.uid });
  }
}

function owns(db, userId, side) {
  const bal = db.prepare("SELECT balance FROM wallets WHERE owner = ? AND currency = 'PWC'").get(userOwner(userId))?.balance || 0;
  if (bal < side.pwc) return false;
  for (const c of side.cards) {
    const qty = db.prepare('SELECT quantity FROM user_cards WHERE user_id = ? AND card_uid = ?').get(userId, c.uid)?.quantity || 0;
    if (qty < c.qty) return false;
  }
  return true;
}

/** Marks open offers past their deadline as expired (lazy, run before reading trades). */
export function expireTrades(db, now = Date.now()) {
  db.prepare("UPDATE trades SET status = 'expirada', resolved_at = ? WHERE status IN ('aberta', 'em_revisao') AND expires_at <= ?").run(now, now);
}

/**
 * Creates an offer. Nothing is reserved: ownership is checked again, atomically, on accept.
 * Offers whose sides differ by more than trade.max_imbalance_cr wait for a moderator (RF-2.15).
 */
export function createTrade(db, from, to, offerIn, requestIn, now = Date.now()) {
  const offer = normalizeSide(offerIn);
  const request = normalizeSide(requestIn);
  if (!offer || !request) throw new EconomyError('bad_request', 400);
  if (!offer.pwc && !offer.cards.length && !request.pwc && !request.cards.length) throw new EconomyError('bad_request', 400);
  if (from.id === to.id) throw new EconomyError('bad_request', 400);
  return transaction(db, () => {
    const block = tradeBlock(db, from, now);
    if (block) throw new EconomyError(block, 403);
    if (tradeBlock(db, to, now)) throw new EconomyError('trade_peer_locked', 403);
    const today = gameDay(now);
    const created = db.prepare('SELECT COUNT(*) AS n FROM trades WHERE from_user = ? AND created_at >= ?').get(from.id, now - DAY_MS).n;
    if (created >= getSetting(db, 'trade.max_per_day')) throw new EconomyError('limit_reached', 409, { day: today });
    checkCards(db, offer);
    checkCards(db, request);
    if (!owns(db, from.id, offer)) throw new EconomyError('insufficient_cards', 409);
    const defaults = rarityDefaults(db);
    const valueOffer = sideValue(db, offer, defaults);
    const valueRequest = sideValue(db, request, defaults);
    const review = Math.abs(valueOffer - valueRequest) > getSetting(db, 'trade.max_imbalance_cr');
    const row = {
      public_id: randomBytes(9).toString('base64url'),
      from_user: from.id,
      to_user: to.id,
      offer: JSON.stringify(offer),
      request: JSON.stringify(request),
    };
    db.prepare(`INSERT INTO trades (public_id, from_user, to_user, offer, request, content_hash, value_offer, value_request, status, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.public_id, from.id, to.id, row.offer, row.request, contentHash(row), valueOffer, valueRequest, review ? 'em_revisao' : 'aberta', now, now + TRADE_TTL_MS);
    return db.prepare('SELECT * FROM trades WHERE public_id = ?').get(row.public_id);
  });
}

const feeOf = (db, pwc) => (pwc > 0 ? Math.max(1, Math.ceil((pwc * getSetting(db, 'trade.fee_pct')) / 100)) : 0);

/** Ledger entries of a PwnCoin transfer: the receiver gets the amount minus the fee, burnt (RF-2.12). */
function pwcTransfer(db, fromId, toId, pwc) {
  if (!pwc) return [];
  const fee = Math.min(pwc, feeOf(db, pwc));
  const out = [{ owner: userOwner(fromId), currency: 'PWC', amount: -pwc }];
  if (pwc - fee > 0) out.push({ owner: userOwner(toId), currency: 'PWC', amount: pwc - fee });
  if (fee > 0) out.push({ owner: BURN, currency: 'PWC', amount: fee });
  return out;
}

/**
 * Accepts an offer: the accepting player sends the hash of what they saw (RF-2.13); both sides are
 * checked and swapped in one transaction. When someone no longer has the items the offer expires.
 */
export function acceptTrade(db, trade, accepter, hash, now = Date.now()) {
  const stale = () => {
    db.prepare("UPDATE trades SET status = 'expirada', resolved_at = ? WHERE id = ? AND status = 'aberta'").run(now, trade.id);
    return new EconomyError('trade_stale', 409);
  };
  try {
    return transaction(db, () => {
      const t = db.prepare('SELECT * FROM trades WHERE id = ?').get(trade.id);
      if (t.to_user !== accepter.id) throw new EconomyError('forbidden', 403);
      if (t.status !== 'aberta') throw new EconomyError('trade_closed', 409, { status: t.status });
      if (t.expires_at <= now) throw new EconomyError('trade_closed', 409, { status: 'expirada' });
      if (hash !== t.content_hash) throw new EconomyError('trade_changed', 409);
      const block = tradeBlock(db, accepter, now);
      if (block) throw new EconomyError(block, 403);
      const from = db.prepare('SELECT * FROM users WHERE id = ?').get(t.from_user);
      if (tradeBlock(db, from, now)) throw new EconomyError('trade_peer_locked', 403);
      const accepted = db.prepare("SELECT COUNT(*) AS n FROM trades WHERE to_user = ? AND status = 'aceita' AND resolved_at >= ?").get(accepter.id, now - DAY_MS).n;
      if (accepted >= getSetting(db, 'trade.max_per_day')) throw new EconomyError('limit_reached', 409);
      const offer = JSON.parse(t.offer);
      const request = JSON.parse(t.request);
      checkCards(db, offer);
      checkCards(db, request);
      const entries = [...pwcTransfer(db, t.from_user, t.to_user, offer.pwc), ...pwcTransfer(db, t.to_user, t.from_user, request.pwc)];
      const cards = [
        ...offer.cards.flatMap((c) => [{ userId: t.from_user, uid: c.uid, delta: -c.qty }, { userId: t.to_user, uid: c.uid, delta: c.qty }]),
        ...request.cards.flatMap((c) => [{ userId: t.to_user, uid: c.uid, delta: -c.qty }, { userId: t.from_user, uid: c.uid, delta: c.qty }]),
      ];
      let res;
      try {
        res = post(db, { kind: 'trade', key: `trade:${t.public_id}`, actor: accepter.id, entries, cards, meta: { trade: t.public_id, from: from.public_id, to: accepter.public_id } });
      } catch (err) {
        if (err instanceof EconomyError && (err.code === 'insufficient_funds' || err.code === 'insufficient_cards')) throw new EconomyError('trade_stale_inner', 409);
        throw err;
      }
      db.prepare("UPDATE trades SET status = 'aceita', tx_id = ?, resolved_at = ? WHERE id = ?").run(res.tx.id, now, t.id);
      return db.prepare('SELECT * FROM trades WHERE id = ?').get(t.id);
    });
  } catch (err) {
    if (err instanceof EconomyError && err.code === 'trade_stale_inner') throw stale();
    throw err;
  }
}

/** decline (receiver) or cancel (sender) while the offer is still pending. */
export function closeTrade(db, trade, user, action, now = Date.now()) {
  const allowed = action === 'decline' ? trade.to_user === user.id : trade.from_user === user.id;
  if (!allowed) throw new EconomyError('forbidden', 403);
  const res = db.prepare("UPDATE trades SET status = ?, resolved_at = ? WHERE id = ? AND status IN ('aberta', 'em_revisao')")
    .run(action === 'decline' ? 'recusada' : 'cancelada', now, trade.id);
  if (!res.changes) throw new EconomyError('trade_closed', 409);
}

/** Copies a player is likely to trade away: above what a deck can use. */
export const KEEP_COPIES = 4;
export const KEEP_LANDS = 20;

/** Players who have what I want and want what I have (RF-2.16), best reciprocity first. */
export function tradeMatches(db, userId, limit = 20) {
  const extra = `SELECT c.user_id, c.card_uid, c.quantity - (CASE WHEN k.kind = 0 THEN ${KEEP_LANDS} ELSE ${KEEP_COPIES} END) AS spare
                 FROM user_cards c JOIN card_catalog k ON k.uid = c.card_uid WHERE k.tradeable = 1 AND k.orphan = 0`;
  const theyHave = db.prepare(`SELECT x.user_id, x.card_uid AS uid, MIN(x.spare, w.qty) AS qty FROM (${extra}) x
                               JOIN wishlist w ON w.card_uid = x.card_uid AND w.user_id = ? WHERE x.spare > 0 AND x.user_id <> ?`).all(userId, userId);
  const iHave = db.prepare(`SELECT w.user_id, w.card_uid AS uid, MIN(x.spare, w.qty) AS qty FROM (${extra}) x
                            JOIN wishlist w ON w.card_uid = x.card_uid WHERE x.user_id = ? AND x.spare > 0 AND w.user_id <> ?`).all(userId, userId);
  const byUser = new Map();
  const entry = (id) => {
    if (!byUser.has(id)) byUser.set(id, { theyHave: [], theyWant: [] });
    return byUser.get(id);
  };
  for (const r of theyHave) entry(r.user_id).theyHave.push({ uid: r.uid, qty: r.qty });
  for (const r of iHave) entry(r.user_id).theyWant.push({ uid: r.uid, qty: r.qty });
  const users = db.prepare(`SELECT id, public_id, display_name FROM users WHERE status = 'active' AND id IN (${[...byUser.keys()].map(() => '?').join(',') || 'NULL'})`).all(...byUser.keys());
  return users
    .map((u) => ({ publicId: u.public_id, displayName: u.display_name, ...byUser.get(u.id) }))
    .sort((a, b) => (Math.min(b.theyHave.length, 1) + Math.min(b.theyWant.length, 1)) - (Math.min(a.theyHave.length, 1) + Math.min(a.theyWant.length, 1))
      || (b.theyHave.length + b.theyWant.length) - (a.theyHave.length + a.theyWant.length))
    .slice(0, limit);
}
