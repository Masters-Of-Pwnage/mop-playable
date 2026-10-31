import { transaction } from '../db.js';
import { apiError } from '../errors.js';
import { requireUser } from '../auth/session.js';
import { audit } from '../auth/users.js';
import { adminGuards } from '../admin/guards.js';
import { EconomyError } from '../economy/ledger.js';
import { acceptTrade, closeTrade, createTrade, expireTrades, KEEP_COPIES, KEEP_LANDS, tradeBlock, tradeMatches, TRADE_TTL_MS } from '../economy/trades.js';

const sideSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pwc: { type: 'integer', minimum: 0, maximum: 1_000_000 },
    cards: { type: 'array', maxItems: 20, items: { type: 'object', required: ['uid', 'qty'], additionalProperties: false, properties: { uid: { type: 'string', maxLength: 160 }, qty: { type: 'integer', minimum: 1, maximum: 60 } } } },
  },
};

/** Trades, wishlist and partner discovery (docs/sdd/02-economia.md §5.4, 05 §6.5). */
export function registerTradeRoutes(app, { db, config }) {
  const auth = requireUser(db, config);
  const g = adminGuards(db, config);
  const enabled = () => config.features.has('trades');
  const users = new Map(); // id -> {publicId, displayName}, per request
  const person = (id) => {
    if (!users.has(id)) {
      const u = db.prepare('SELECT public_id, display_name FROM users WHERE id = ?').get(id);
      users.set(id, u ? { publicId: u.public_id, displayName: u.display_name } : null);
    }
    return users.get(id);
  };
  const view = (t) => ({
    id: t.public_id,
    from: person(t.from_user),
    to: person(t.to_user),
    offer: JSON.parse(t.offer),
    request: JSON.parse(t.request),
    valueOffer: t.value_offer,
    valueRequest: t.value_request,
    contentHash: t.content_hash,
    status: t.status,
    createdAt: t.created_at,
    expiresAt: t.expires_at,
    resolvedAt: t.resolved_at,
  });
  const send = (reply, err) => {
    if (!(err instanceof EconomyError)) throw err;
    return reply.code(err.status).send({ ...apiError(err.code), ...err.details });
  };
  const findTrade = (id) => db.prepare('SELECT * FROM trades WHERE public_id = ?').get(String(id));

  app.get('/api/trades', {
    onRequest: auth,
    schema: { querystring: { type: 'object', properties: { box: { enum: ['in', 'out', 'history'] } } } },
  }, async (req) => {
    users.clear();
    expireTrades(db);
    const me = req.auth.user.id;
    const box = req.query.box || 'in';
    const rows = box === 'in'
      ? db.prepare("SELECT * FROM trades WHERE to_user = ? AND status = 'aberta' ORDER BY id DESC LIMIT 100").all(me)
      : box === 'out'
        ? db.prepare("SELECT * FROM trades WHERE from_user = ? AND status IN ('aberta', 'em_revisao') ORDER BY id DESC LIMIT 100").all(me)
        : db.prepare("SELECT * FROM trades WHERE (from_user = ? OR to_user = ?) AND status NOT IN ('aberta', 'em_revisao') ORDER BY id DESC LIMIT 100").all(me, me);
    return { trades: rows.map(view), canTrade: tradeBlock(db, req.auth.user) === '', enabled: enabled() };
  });

  app.post('/api/trades', {
    onRequest: auth,
    schema: { body: { type: 'object', required: ['to', 'offer', 'request'], additionalProperties: false, properties: { to: { type: 'string', maxLength: 20 }, offer: sideSchema, request: sideSchema } } },
  }, async (req, reply) => {
    if (!enabled()) return reply.code(403).send(apiError('trades_disabled'));
    const to = db.prepare('SELECT * FROM users WHERE public_id = ?').get(req.body.to.toUpperCase());
    if (!to || to.status === 'deleted') return reply.code(404).send(apiError('user_not_found'));
    try {
      users.clear();
      return { trade: view(createTrade(db, req.auth.user, to, req.body.offer, req.body.request)) };
    } catch (err) {
      return send(reply, err);
    }
  });

  app.post('/api/trades/:id/accept', {
    onRequest: auth,
    schema: { body: { type: 'object', required: ['contentHash'], additionalProperties: false, properties: { contentHash: { type: 'string', maxLength: 64 } } } },
  }, async (req, reply) => {
    if (!enabled()) return reply.code(403).send(apiError('trades_disabled'));
    const t = findTrade(req.params.id);
    if (!t || (t.to_user !== req.auth.user.id && t.from_user !== req.auth.user.id)) return reply.code(404).send(apiError('not_found'));
    try {
      users.clear();
      return { trade: view(acceptTrade(db, t, req.auth.user, req.body.contentHash)) };
    } catch (err) {
      return send(reply, err);
    }
  });

  for (const action of ['decline', 'cancel']) {
    app.post(`/api/trades/:id/${action}`, { onRequest: auth }, async (req, reply) => {
      const t = findTrade(req.params.id);
      if (!t || (t.to_user !== req.auth.user.id && t.from_user !== req.auth.user.id)) return reply.code(404).send(apiError('not_found'));
      try {
        closeTrade(db, t, req.auth.user, action);
        users.clear();
        return { trade: view(findTrade(t.public_id)) };
      } catch (err) {
        return send(reply, err);
      }
    });
  }

  app.get('/api/trades/matches', { onRequest: auth }, async (req) => ({ matches: tradeMatches(db, req.auth.user.id) }));

  app.get('/api/me/wishlist', { onRequest: auth }, async (req) => ({
    cards: db.prepare('SELECT card_uid AS uid, qty FROM wishlist WHERE user_id = ?').all(req.auth.user.id).map((r) => ({ ...r })),
  }));

  app.put('/api/me/wishlist', {
    onRequest: auth,
    schema: { body: { type: 'object', required: ['cards'], additionalProperties: false, properties: { cards: { type: 'array', maxItems: 300, items: { type: 'object', required: ['uid', 'qty'], additionalProperties: false, properties: { uid: { type: 'string', maxLength: 160 }, qty: { type: 'integer', minimum: 1, maximum: 60 } } } } } } },
  }, async (req, reply) => {
    const userId = req.auth.user.id;
    for (const c of req.body.cards) {
      if (!db.prepare('SELECT 1 FROM card_catalog WHERE uid = ? AND orphan = 0').get(c.uid)) return reply.code(400).send({ ...apiError('not_found'), uid: c.uid });
    }
    transaction(db, () => {
      db.prepare('DELETE FROM wishlist WHERE user_id = ?').run(userId);
      for (const c of req.body.cards) {
        db.prepare('INSERT INTO wishlist (user_id, card_uid, qty) VALUES (?, ?, ?) ON CONFLICT (user_id, card_uid) DO UPDATE SET qty = excluded.qty').run(userId, c.uid, c.qty);
      }
    });
    return { cards: req.body.cards };
  });

  /** Partner search for a trade (display names are public in the lobby anyway). */
  app.get('/api/players', {
    onRequest: auth,
    schema: { querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', minLength: 2, maxLength: 40 } } } },
  }, async (req) => {
    const q = req.query.q.trim();
    const like = `${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = db.prepare(`SELECT public_id, display_name FROM users WHERE status = 'active' AND id <> ? AND (display_name LIKE ? ESCAPE '\\' OR public_id = ?)
                             ORDER BY last_login_at DESC LIMIT 10`).all(req.auth.user.id, like, q.toUpperCase());
    return { players: rows.map((r) => ({ publicId: r.public_id, displayName: r.display_name })) };
  });

  /** Spare copies a player could trade (above what a deck uses), to build the request side. */
  app.get('/api/players/:publicId/spare', { onRequest: auth }, async (req, reply) => {
    const u = db.prepare("SELECT id, public_id, display_name FROM users WHERE public_id = ? AND status = 'active'").get(String(req.params.publicId).toUpperCase());
    if (!u) return reply.code(404).send(apiError('user_not_found'));
    const cards = db.prepare(`SELECT c.card_uid AS uid, c.quantity - (CASE WHEN k.kind = 0 THEN ${KEEP_LANDS} ELSE ${KEEP_COPIES} END) AS qty
                              FROM user_cards c JOIN card_catalog k ON k.uid = c.card_uid
                              WHERE c.user_id = ? AND k.tradeable = 1 AND k.orphan = 0 AND qty > 0`).all(u.id).map((r) => ({ ...r }));
    return { player: { publicId: u.public_id, displayName: u.display_name }, cards };
  });

  // ------------------------------------------------------------------ admin

  app.get('/api/admin/trades', {
    onRequest: g.staff,
    schema: { querystring: { type: 'object', properties: { status: { type: 'string', maxLength: 20 } } } },
  }, async (req) => {
    users.clear();
    expireTrades(db);
    const rows = req.query.status
      ? db.prepare('SELECT * FROM trades WHERE status = ? ORDER BY id DESC LIMIT 100').all(req.query.status)
      : db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT 100').all();
    return { trades: rows.map((t) => ({ ...view(t), txId: t.tx_id })) };
  });

  for (const action of ['approve', 'reject']) {
    app.post(`/api/admin/trades/:id/${action}`, {
      onRequest: g.staff,
      schema: { body: { type: 'object', required: ['reason'], properties: { reason: { type: 'string', minLength: 3, maxLength: 300 } } } },
    }, async (req, reply) => {
      const t = findTrade(req.params.id);
      if (!t) return reply.code(404).send(apiError('not_found'));
      if (t.from_user === req.auth.user.id || t.to_user === req.auth.user.id) return reply.code(403).send(apiError('forbidden', 'Você participa desta troca.'));
      const now = Date.now();
      const changed = transaction(db, () => {
        const res = action === 'approve'
          ? db.prepare("UPDATE trades SET status = 'aberta', reviewed_by = ?, expires_at = ? WHERE id = ? AND status = 'em_revisao'").run(req.auth.user.id, now + TRADE_TTL_MS, t.id)
          : db.prepare("UPDATE trades SET status = 'recusada', reviewed_by = ?, resolved_at = ? WHERE id = ? AND status = 'em_revisao'").run(req.auth.user.id, now, t.id);
        if (res.changes) audit(db, { actor: req.auth.user.id, action: `trade.${action}`, target: `trade:${t.public_id}`, after: { reason: req.body.reason }, ip: req.clientIp });
        return res.changes;
      });
      if (!changed) return reply.code(409).send(apiError('trade_closed'));
      users.clear();
      return { trade: view(findTrade(t.public_id)) };
    });
  }
}
