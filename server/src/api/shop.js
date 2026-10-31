import { transaction } from '../db.js';
import { apiError } from '../errors.js';
import { requireUser } from '../auth/session.js';
import { effective, publicEntry, rarityDefaults, unavailableReason } from '../economy/catalog.js';
import { claimDaily } from '../economy/grants.js';
import { balances, EconomyError, post, SHOP, userOwner, wallet } from '../economy/ledger.js';
import { getSetting } from '../economy/settings.js';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_ITEMS = 60;

const itemsSchema = {
  type: 'object',
  required: ['items'],
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_ITEMS,
      items: {
        type: 'object',
        required: ['uid', 'qty', 'expectedPrice'],
        additionalProperties: false,
        properties: {
          uid: { type: 'string', minLength: 1, maxLength: 160 },
          qty: { type: 'integer', minimum: 1, maximum: MAX_ITEMS },
          expectedPrice: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
};

function catalogRow(db, uid) {
  const row = db.prepare('SELECT * FROM card_catalog WHERE uid = ?').get(uid);
  if (!row) throw new EconomyError('not_available', 404, { uid });
  return row;
}

const owned = (db, userId, uid) => db.prepare('SELECT quantity FROM user_cards WHERE user_id = ? AND card_uid = ?').get(userId, uid)?.quantity || 0;

/** Buys catalog cards with credits. Every rule is checked inside the write transaction (S2). */
export function buyCards(db, userId, items, clientKey, now = Date.now()) {
  const key = `shop_buy:${userId}:${clientKey}`;
  return transaction(db, () => {
    const prior = db.prepare('SELECT * FROM ledger_tx WHERE idempotency_key = ?').get(key);
    if (prior) return { tx: prior, replayed: true };
    const defaults = rarityDefaults(db);
    let total = 0;
    const cards = [];
    const seen = new Set();
    for (const { uid, qty, expectedPrice } of items) {
      if (seen.has(uid)) throw new EconomyError('bad_request', 400, { uid });
      seen.add(uid);
      const row = catalogRow(db, uid);
      const why = unavailableReason(row, now);
      if (why) throw new EconomyError(why, 409, { uid });
      const e = effective(row, defaults);
      if (expectedPrice !== e.price) throw new EconomyError('price_changed', 409, { uid, price: e.price });
      if (row.stock_total !== null && row.stock_sold + qty > row.stock_total) throw new EconomyError('sold_out', 409, { uid });
      if (row.per_user_limit !== null) {
        const bought = db.prepare(`SELECT COALESCE(SUM(m.delta), 0) AS n FROM inventory_moves m JOIN ledger_tx t ON t.id = m.tx_id
                                   WHERE m.user_id = ? AND m.card_uid = ? AND t.kind = 'shop_buy'`).get(userId, uid).n;
        if (bought + qty > row.per_user_limit) throw new EconomyError('limit_reached', 409, { uid });
      }
      if (e.maxOwned !== null && owned(db, userId, uid) + qty > e.maxOwned) throw new EconomyError('max_owned', 409, { uid });
      db.prepare('UPDATE card_catalog SET stock_sold = stock_sold + ? WHERE uid = ?').run(qty, uid);
      total += e.price * qty;
      cards.push({ userId, uid, delta: qty });
    }
    const entries = total > 0 ? [{ owner: userOwner(userId), currency: 'CR', amount: -total }, { owner: SHOP, currency: 'CR', amount: total }] : [];
    return post(db, { kind: 'shop_buy', key, actor: userId, entries, cards, meta: { items: items.map(({ uid, qty }) => ({ uid, qty })), total } });
  });
}

/** Sells copies back for credits. Event and reward cards cannot be sold (RF-2.8). */
export function sellCards(db, userId, items, clientKey) {
  const key = `shop_sell:${userId}:${clientKey}`;
  return transaction(db, () => {
    const prior = db.prepare('SELECT * FROM ledger_tx WHERE idempotency_key = ?').get(key);
    if (prior) return { tx: prior, replayed: true };
    const defaults = rarityDefaults(db);
    let total = 0;
    const cards = [];
    const seen = new Set();
    for (const { uid, qty, expectedPrice } of items) {
      if (seen.has(uid)) throw new EconomyError('bad_request', 400, { uid });
      seen.add(uid);
      const row = catalogRow(db, uid);
      if (row.availability === 'evento' || row.availability === 'recompensa') throw new EconomyError('not_sellable', 409, { uid });
      const { sellPrice } = effective(row, defaults);
      if (expectedPrice !== sellPrice) throw new EconomyError('price_changed', 409, { uid, price: sellPrice });
      total += sellPrice * qty;
      cards.push({ userId, uid, delta: -qty });
    }
    const entries = total > 0 ? [{ owner: SHOP, currency: 'CR', amount: -total }, { owner: userOwner(userId), currency: 'CR', amount: total }] : [];
    return post(db, { kind: 'shop_sell', key, actor: userId, entries, cards, meta: { items: items.map(({ uid, qty }) => ({ uid, qty })), total } });
  });
}

/** Catalog, wallet, collection, statement, daily bonus and the card shop (docs/sdd/02-economia.md §6). */
export function registerShopRoutes(app, { db, config }) {
  const auth = requireUser(db, config);
  const shopOpen = () => config.features.has('shop');

  function idempotencyKey(req, reply) {
    const key = req.headers['idempotency-key'];
    if (typeof key === 'string' && IDEMPOTENCY_KEY.test(key)) return key;
    reply.code(400).send(apiError('idempotency_required'));
    return null;
  }

  function sendEconomyError(reply, err) {
    if (!(err instanceof EconomyError)) throw err;
    return reply.code(err.status).send({ ...apiError(err.code), ...err.details });
  }

  function collection(userId) {
    return db.prepare('SELECT card_uid AS uid, quantity AS qty FROM user_cards WHERE user_id = ? AND quantity > 0').all(userId).map((r) => ({ ...r }));
  }

  app.get('/api/catalog', async (_req, reply) => {
    const defaults = rarityDefaults(db);
    const now = Date.now();
    const rows = db.prepare('SELECT * FROM card_catalog WHERE orphan = 0').all();
    reply.header('Cache-Control', 'public, max-age=60');
    return {
      shopOpen: shopOpen(),
      rarities: Object.values(defaults).sort((a, b) => a.sort - b.sort).map((d) => ({ rarity: d.rarity, price: d.price_credits, sellPrice: d.sell_credits })),
      cards: rows.map((r) => publicEntry(r, defaults, now)),
    };
  });

  app.get('/api/me/wallet', { preValidation: auth }, async (req) => ({
    balances: balances(db, req.auth.user.id),
    pwcToCr: getSetting(db, 'economy.pwc_to_cr'),
  }));

  app.get('/api/me/collection', { preValidation: auth }, async (req) => ({ cards: collection(req.auth.user.id) }));

  /** Statement: the user's ledger entries, newest first, paged by transaction id. */
  app.get('/api/me/ledger', {
    preValidation: auth,
    schema: { querystring: { type: 'object', properties: { before: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 } } } },
  }, async (req) => {
    const userId = req.auth.user.id;
    for (const currency of ['PWC', 'CR']) wallet(db, userOwner(userId), currency);
    const limit = req.query.limit || 50;
    const rows = db.prepare(`SELECT t.id, t.kind, t.meta, t.created_at, w.currency, SUM(e.amount) AS amount
                             FROM ledger_tx t JOIN ledger_entries e ON e.tx_id = t.id JOIN wallets w ON w.id = e.wallet_id
                             WHERE w.owner = ? AND t.id < ? GROUP BY t.id, w.currency ORDER BY t.id DESC LIMIT ?`)
      .all(userOwner(userId), req.query.before || Number.MAX_SAFE_INTEGER, limit);
    const cardRows = db.prepare(`SELECT tx_id, card_uid AS uid, delta FROM inventory_moves WHERE user_id = ? AND tx_id IN (${rows.map(() => '?').join(',') || 'NULL'})`)
      .all(userId, ...rows.map((r) => r.id));
    const cardsByTx = new Map();
    for (const c of cardRows) cardsByTx.set(c.tx_id, [...(cardsByTx.get(c.tx_id) || []), { uid: c.uid, delta: c.delta }]);
    return {
      entries: rows.map((r) => ({ tx: r.id, kind: r.kind, currency: r.currency, amount: r.amount, cards: cardsByTx.get(r.id) || [], meta: r.meta ? JSON.parse(r.meta) : null, createdAt: r.created_at })),
      next: rows.length === limit ? rows[rows.length - 1].id : null,
    };
  });

  app.post('/api/me/daily', { preValidation: auth }, async (req) => {
    const result = claimDaily(db, req.auth.user.id);
    return { ...result, balances: balances(db, req.auth.user.id) };
  });

  app.post('/api/shop/buy', { preValidation: auth, schema: { body: itemsSchema } }, async (req, reply) => {
    if (!shopOpen()) return reply.code(403).send(apiError('shop_disabled'));
    const key = idempotencyKey(req, reply);
    if (!key) return reply;
    const userId = req.auth.user.id;
    try {
      const { tx, replayed } = buyCards(db, userId, req.body.items, key);
      return { tx: tx.id, replayed, balances: balances(db, userId), cards: collection(userId) };
    } catch (err) {
      return sendEconomyError(reply, err);
    }
  });

  app.post('/api/shop/sell', { preValidation: auth, schema: { body: itemsSchema } }, async (req, reply) => {
    if (!shopOpen()) return reply.code(403).send(apiError('shop_disabled'));
    const key = idempotencyKey(req, reply);
    if (!key) return reply;
    const userId = req.auth.user.id;
    try {
      const { tx, replayed } = sellCards(db, userId, req.body.items, key);
      return { tx: tx.id, replayed, balances: balances(db, userId), cards: collection(userId) };
    } catch (err) {
      return sendEconomyError(reply, err);
    }
  });
}
