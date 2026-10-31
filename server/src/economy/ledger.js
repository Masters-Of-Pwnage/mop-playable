import { transaction } from '../db.js';

/** A business rule refused the operation; `code` maps to ERRORS in protocol.js. */
export class EconomyError extends Error {
  constructor(code, status = 409, details = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const CURRENCIES = ['PWC', 'CR'];
export const userOwner = (userId) => `user:${userId}`;
export const MINT = 'system:mint';
export const SHOP = 'system:shop';
export const BURN = 'system:burn';
export const CONVERSION = 'system:conversion';

/** The wallet row of (owner, currency), created on first use. */
export function wallet(db, owner, currency) {
  const find = () => db.prepare('SELECT * FROM wallets WHERE owner = ? AND currency = ?').get(owner, currency);
  let row = find();
  if (!row) {
    db.prepare('INSERT INTO wallets (owner, currency, is_system) VALUES (?, ?, ?)').run(owner, currency, owner.startsWith('system:') ? 1 : 0);
    row = find();
  }
  return row;
}

export function balances(db, userId) {
  const out = { PWC: 0, CR: 0 };
  for (const r of db.prepare('SELECT currency, balance FROM wallets WHERE owner = ?').all(userOwner(userId))) out[r.currency] = r.balance;
  return out;
}

/**
 * Posts one ledger transaction (ADR-05):
 *   entries: [{ owner, currency, amount }]  must sum to zero per currency
 *   cards:   [{ userId, uid, delta }]       collection changes made by the same transaction
 * Runs inside a write transaction; a repeated idempotency key returns the original transaction
 * and changes nothing. Insufficient balance or cards aborts everything with an EconomyError.
 */
export function post(db, { kind, key, actor = null, entries = [], cards = [], meta = null, reason = null, reverses = null }) {
  return transaction(db, () => {
    const existing = db.prepare('SELECT * FROM ledger_tx WHERE idempotency_key = ?').get(key);
    if (existing) {
      if (existing.kind !== kind || existing.actor_user_id !== actor) throw new EconomyError('idempotency_conflict', 422);
      return { tx: existing, replayed: true };
    }
    const sums = {};
    for (const e of entries) {
      if (!CURRENCIES.includes(e.currency) || !Number.isSafeInteger(e.amount) || e.amount === 0) throw new Error(`ledger: bad entry in ${kind}`);
      sums[e.currency] = (sums[e.currency] || 0) + e.amount;
    }
    for (const [currency, sum] of Object.entries(sums)) {
      if (sum !== 0) throw new Error(`ledger: ${kind} does not balance in ${currency} (${sum})`);
    }
    const now = Date.now();
    const txId = Number(db.prepare(`INSERT INTO ledger_tx (kind, idempotency_key, actor_user_id, reason, reverses_tx_id, meta, created_at)
                                    VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(kind, key, actor, reason, reverses, meta === null ? null : JSON.stringify(meta), now).lastInsertRowid);

    for (const e of entries) {
      const w = wallet(db, e.owner, e.currency);
      try {
        db.prepare('UPDATE wallets SET balance = balance + ? WHERE id = ?').run(e.amount, w.id);
      } catch (err) {
        if (/CHECK constraint failed/.test(err.message)) throw new EconomyError('insufficient_funds', 409, { currency: e.currency });
        throw err;
      }
      db.prepare('INSERT INTO ledger_entries (tx_id, wallet_id, amount) VALUES (?, ?, ?)').run(txId, w.id, e.amount);
    }

    for (const c of cards) {
      if (!Number.isSafeInteger(c.delta) || c.delta === 0) throw new Error(`ledger: bad card move in ${kind}`);
      if (c.delta > 0) {
        db.prepare(`INSERT INTO user_cards (user_id, card_uid, quantity) VALUES (?, ?, ?)
                    ON CONFLICT (user_id, card_uid) DO UPDATE SET quantity = quantity + excluded.quantity`).run(c.userId, c.uid, c.delta);
      } else {
        const res = db.prepare('UPDATE user_cards SET quantity = quantity + ? WHERE user_id = ? AND card_uid = ? AND quantity + ? >= 0')
          .run(c.delta, c.userId, c.uid, c.delta);
        if (!res.changes) throw new EconomyError('insufficient_cards', 409, { uid: c.uid });
      }
      db.prepare('INSERT INTO inventory_moves (tx_id, user_id, card_uid, delta, created_at) VALUES (?, ?, ?, ?, ?)').run(txId, c.userId, c.uid, c.delta, now);
    }
    return { tx: db.prepare('SELECT * FROM ledger_tx WHERE id = ?').get(txId), replayed: false };
  });
}

/**
 * Reversal (RF-2.3): a mirror transaction of `txId`, once. Fails with insufficient_* when the player
 * already spent what it would take back. Returns { tx, replayed }.
 */
export function reverseTransaction(db, txId, actorId, reason) {
  const t = db.prepare('SELECT * FROM ledger_tx WHERE id = ?').get(txId);
  if (!t) throw new EconomyError('not_found', 404);
  if (t.kind === 'reversal') throw new EconomyError('bad_request', 400);
  const entries = db.prepare('SELECT w.owner, w.currency, e.amount FROM ledger_entries e JOIN wallets w ON w.id = e.wallet_id WHERE e.tx_id = ?').all(t.id)
    .map((e) => ({ owner: e.owner, currency: e.currency, amount: -e.amount }));
  const cards = db.prepare('SELECT user_id, card_uid, delta FROM inventory_moves WHERE tx_id = ?').all(t.id).map((m) => ({ userId: m.user_id, uid: m.card_uid, delta: -m.delta }));
  return post(db, { kind: 'reversal', key: `reversal:${t.id}`, actor: actorId, reason, reverses: t.id, entries, cards, meta: { of: t.kind } });
}

/** Invariants I1–I5 of 00-arquitetura §4. Returns a list of violations (empty = healthy). */
export function checkInvariants(db) {
  const problems = [];
  for (const r of db.prepare(`SELECT e.tx_id, w.currency, SUM(e.amount) AS s FROM ledger_entries e JOIN wallets w ON w.id = e.wallet_id
                              GROUP BY e.tx_id, w.currency HAVING s <> 0`).all()) problems.push(`I1 tx ${r.tx_id} ${r.currency} soma ${r.s}`);
  for (const r of db.prepare(`SELECT w.id, w.owner, w.currency, w.balance, COALESCE(SUM(e.amount), 0) AS s FROM wallets w
                              LEFT JOIN ledger_entries e ON e.wallet_id = w.id GROUP BY w.id HAVING s <> w.balance`).all()) problems.push(`I2 ${r.owner} ${r.currency}`);
  for (const r of db.prepare('SELECT owner, currency, balance FROM wallets WHERE is_system = 0 AND balance < 0').all()) problems.push(`I3 ${r.owner} ${r.currency}`);
  for (const r of db.prepare(`SELECT c.user_id, c.card_uid FROM user_cards c LEFT JOIN
                              (SELECT user_id, card_uid, SUM(delta) AS s FROM inventory_moves GROUP BY user_id, card_uid) m
                              ON m.user_id = c.user_id AND m.card_uid = c.card_uid WHERE COALESCE(m.s, 0) <> c.quantity`).all()) problems.push(`I3b coleção ${r.user_id} ${r.card_uid}`);
  // Selling a card back does not restock it: stock_sold counts shop purchases only.
  for (const r of db.prepare(`SELECT uid FROM (SELECT k.uid, k.stock_sold, (SELECT COALESCE(SUM(m.delta), 0) FROM inventory_moves m
                              JOIN ledger_tx t ON t.id = m.tx_id WHERE m.card_uid = k.uid AND t.kind = 'shop_buy') AS s FROM card_catalog k)
                              WHERE s <> stock_sold`).all()) problems.push(`I4 estoque ${r.uid}`);
  for (const r of db.prepare('SELECT currency, SUM(balance) AS s FROM wallets GROUP BY currency HAVING s <> 0').all()) problems.push(`I5 ${r.currency} soma ${r.s}`);
  return problems;
}
