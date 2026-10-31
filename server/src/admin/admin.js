import fs from 'node:fs';
import { transaction } from '../db.js';
import { apiError } from '../errors.js';
import { revokeUserSessions } from '../auth/session.js';
import { audit } from '../auth/users.js';
import { FEATURES } from '../config.js';
import { balances, checkInvariants, EconomyError, MINT, post, reverseTransaction, SHOP, userOwner } from '../economy/ledger.js';
import { DEFAULTS, getSetting, setSetting } from '../economy/settings.js';
import { listBackups } from '../backup.js';
import { adminGuards, canActOn, ROLE_RANK, stepUp } from './guards.js';

/** Flags an admin may switch at runtime; `accounts` needs secrets and a restart, so it stays in FEATURES. */
export const RUNTIME_FLAGS = FEATURES.filter((f) => f !== 'accounts');
const OWNER_FLAGS = ['packs', 'payments']; // legal validation pending (D10): only the owner turns them on
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** Applies the flag overrides saved in settings on top of FEATURES (called on boot). */
export function applyFlagOverrides(db, config) {
  const flags = getSetting(db, 'flags') || {};
  for (const [name, on] of Object.entries(flags)) {
    if (!RUNTIME_FLAGS.includes(name)) continue;
    if (on) config.features.add(name);
    else config.features.delete(name);
  }
}

const maskEmail = (email) => (email ? email.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => `${a}${'•'.repeat(Math.min(b.length, 6))}${c}`) : null);

function userSummary(u, viewer) {
  return {
    publicId: u.public_id,
    displayName: u.display_name,
    email: viewer.role === 'moderator' ? maskEmail(u.email) : u.email,
    role: u.role,
    status: u.status,
    suspendedUntil: u.suspended_until,
    tradeLockedUntil: u.trade_locked_until,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

/** Admin API besides the catalog (docs/sdd/04-admin.md §5–§8). */
export function registerAdmin(app, { db, config, rooms }) {
  const g = adminGuards(db, config);

  const findUser = (publicId) => db.prepare('SELECT * FROM users WHERE public_id = ?').get(String(publicId));
  function target(req, reply) {
    const user = findUser(req.params.publicId);
    if (!user) {
      reply.code(404).send(apiError('not_found'));
      return null;
    }
    if (!canActOn(req.auth.user, user)) {
      reply.code(403).send(apiError('forbidden', 'Você não pode agir sobre esta conta.'));
      return null;
    }
    return user;
  }

  // -------------------------------------------------------------- dashboard

  app.get('/api/admin/dashboard', { onRequest: g.staff }, async () => {
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    const one = (sql, ...args) => db.prepare(sql).get(...args);
    const wallet = (owner, currency) => one('SELECT balance FROM wallets WHERE owner = ? AND currency = ?', owner, currency)?.balance || 0;
    return {
      users: one("SELECT COUNT(*) AS n FROM users WHERE status <> 'deleted'").n,
      newUsers7d: one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', now - 7 * day).n,
      active24h: one('SELECT COUNT(*) AS n FROM users WHERE last_login_at >= ?', now - day).n,
      active7d: one('SELECT COUNT(*) AS n FROM users WHERE last_login_at >= ?', now - 7 * day).n,
      sessions: one('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?', now).n,
      rooms: rooms.stats(),
      credits: { issued: -wallet(MINT, 'CR'), shopRevenue: wallet(SHOP, 'CR'), inCirculation: one("SELECT COALESCE(SUM(balance), 0) AS n FROM wallets WHERE is_system = 0 AND currency = 'CR'").n },
      pwc: { issued: -wallet(MINT, 'PWC'), inCirculation: one("SELECT COALESCE(SUM(balance), 0) AS n FROM wallets WHERE is_system = 0 AND currency = 'PWC'").n },
      salesByRarity7d: db.prepare(`SELECT k.rarity, SUM(m.delta) AS copies FROM inventory_moves m JOIN ledger_tx t ON t.id = m.tx_id
                                   JOIN card_catalog k ON k.uid = m.card_uid WHERE t.kind = 'shop_buy' AND t.created_at >= ? GROUP BY k.rarity`)
        .all(now - 7 * day).map((r) => ({ ...r })),
      topCards7d: db.prepare(`SELECT k.uid, k.name, SUM(m.delta) AS copies FROM inventory_moves m JOIN ledger_tx t ON t.id = m.tx_id
                              JOIN card_catalog k ON k.uid = m.card_uid WHERE t.kind = 'shop_buy' AND t.created_at >= ?
                              GROUP BY k.uid ORDER BY copies DESC LIMIT 10`).all(now - 7 * day).map((r) => ({ ...r })),
      flags: [...config.features],
    };
  });

  // --------------------------------------------------------- settings/flags

  app.get('/api/admin/settings', { onRequest: g.staff }, async () => ({
    settings: Object.keys(DEFAULTS).map((key) => ({ key, value: getSetting(db, key), default: DEFAULTS[key] })),
  }));

  app.put('/api/admin/settings/:key', { onRequest: g.admin, schema: { body: { type: 'object', required: ['value'] } } }, async (req, reply) => {
    const { key } = req.params;
    if (!(key in DEFAULTS)) return reply.code(404).send(apiError('not_found'));
    const { value } = req.body;
    const def = DEFAULTS[key];
    const valid = typeof def === 'number'
      ? Number.isSafeInteger(value) && value >= 0
      : value && typeof value === 'object' && Object.keys(def).every((k) => Number.isSafeInteger(value[k]) && value[k] >= 0) && Object.keys(value).length === Object.keys(def).length;
    if (!valid) return reply.code(400).send({ ...apiError('invalid_value'), field: key });
    if (key === 'admin.adjust_cap' && req.auth.user.role !== 'owner') return reply.code(403).send(apiError('forbidden'));
    transaction(db, () => {
      const before = getSetting(db, key);
      setSetting(db, key, value, req.auth.user.id);
      audit(db, { actor: req.auth.user.id, action: 'settings.update', target: `setting:${key}`, before: { value: before }, after: { value }, ip: req.clientIp });
    });
    return { key, value };
  });

  app.get('/api/admin/flags', { onRequest: g.staff }, async () => ({
    flags: FEATURES.map((name) => ({ name, on: config.features.has(name), runtime: RUNTIME_FLAGS.includes(name), ownerOnly: OWNER_FLAGS.includes(name) })),
  }));

  app.put('/api/admin/flags/:name', {
    onRequest: g.admin,
    schema: { body: { type: 'object', required: ['on'], additionalProperties: false, properties: { on: { type: 'boolean' } } } },
  }, async (req, reply) => {
    const { name } = req.params;
    if (!RUNTIME_FLAGS.includes(name)) return reply.code(400).send(apiError('bad_request', 'Esta flag não pode ser alterada em tempo de execução.'));
    if (OWNER_FLAGS.includes(name) && req.auth.user.role !== 'owner') return reply.code(403).send(apiError('forbidden'));
    transaction(db, () => {
      const flags = { ...(getSetting(db, 'flags') || {}), [name]: req.body.on };
      setSetting(db, 'flags', flags, req.auth.user.id);
      audit(db, { actor: req.auth.user.id, action: 'flags.update', target: `flag:${name}`, before: { on: config.features.has(name) }, after: { on: req.body.on }, ip: req.clientIp });
    });
    if (req.body.on) config.features.add(name);
    else config.features.delete(name);
    return { name, on: req.body.on };
  });

  // ------------------------------------------------------------------ users

  app.get('/api/admin/users', {
    onRequest: g.staff,
    schema: { querystring: { type: 'object', properties: { q: { type: 'string', maxLength: 100 } } } },
  }, async (req) => {
    const q = (req.query.q || '').trim();
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = q
      ? db.prepare(`SELECT * FROM users WHERE public_id = ? OR display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' ORDER BY last_login_at DESC LIMIT 50`).all(q.toUpperCase(), like, like)
      : db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 50').all();
    return { users: rows.map((u) => userSummary(u, req.auth.user)) };
  });

  app.get('/api/admin/users/:publicId', { onRequest: g.staff }, async (req, reply) => {
    const u = findUser(req.params.publicId);
    if (!u) return reply.code(404).send(apiError('not_found'));
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    return {
      user: userSummary(u, req.auth.user),
      balances: balances(db, u.id),
      collection: one('SELECT COUNT(*) AS distinctCards, COALESCE(SUM(quantity), 0) AS copies FROM user_cards WHERE user_id = ? AND quantity > 0', u.id),
      sessions: one('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?', u.id, Date.now()).n,
      decks: one('SELECT COUNT(*) AS n FROM decks WHERE user_id = ?', u.id).n,
      ledger: db.prepare(`SELECT t.id, t.kind, t.reason, t.created_at AS createdAt, w.currency, SUM(e.amount) AS amount FROM ledger_tx t
                          JOIN ledger_entries e ON e.tx_id = t.id JOIN wallets w ON w.id = e.wallet_id WHERE w.owner = ?
                          GROUP BY t.id, w.currency ORDER BY t.id DESC LIMIT 30`).all(userOwner(u.id)).map((r) => ({ ...r })),
      audit: db.prepare(`SELECT a.id, a.action, a.after, a.created_at AS createdAt, x.display_name AS actor FROM audit_log a
                         LEFT JOIN users x ON x.id = a.actor_user_id WHERE a.target = ? ORDER BY a.id DESC LIMIT 30`)
        .all(`user:${u.id}`).map((r) => ({ ...r, after: JSON.parse(r.after || 'null') })),
      canAct: canActOn(req.auth.user, u),
    };
  });

  const reasonSchema = { type: 'string', minLength: 3, maxLength: 300 };

  app.post('/api/admin/users/:publicId/status', {
    onRequest: g.staff,
    schema: {
      body: {
        type: 'object',
        required: ['action', 'reason'],
        additionalProperties: false,
        properties: { action: { enum: ['suspend', 'ban', 'unban'] }, until: { type: 'integer', minimum: 1 }, reason: reasonSchema },
      },
    },
  }, async (req, reply) => {
    const u = target(req, reply);
    if (!u) return reply;
    const { action, until, reason } = req.body;
    if (action === 'suspend' && (!until || until <= Date.now())) return reply.code(400).send({ ...apiError('invalid_value'), field: 'until' });
    const status = { suspend: 'suspended', ban: 'banned', unban: 'active' }[action];
    if (u.status === 'deleted') return reply.code(409).send(apiError('bad_request', 'Conta excluída.'));
    transaction(db, () => {
      db.prepare('UPDATE users SET status = ?, suspended_until = ? WHERE id = ?').run(status, action === 'suspend' ? until : null, u.id);
      if (action !== 'unban') revokeUserSessions(db, u.id);
      audit(db, { actor: req.auth.user.id, action: `user.${action}`, target: `user:${u.id}`, before: { status: u.status }, after: { status, until: until || null, reason }, ip: req.clientIp });
    });
    return { user: userSummary(findUser(u.public_id), req.auth.user) };
  });

  app.post('/api/admin/users/:publicId/trade-lock', {
    onRequest: g.staff,
    schema: { body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { until: { type: ['integer', 'null'] }, reason: reasonSchema } } },
  }, async (req, reply) => {
    const u = target(req, reply);
    if (!u) return reply;
    const until = req.body.until ?? null;
    transaction(db, () => {
      db.prepare('UPDATE users SET trade_locked_until = ? WHERE id = ?').run(until, u.id);
      audit(db, { actor: req.auth.user.id, action: 'user.trade_lock', target: `user:${u.id}`, before: { until: u.trade_locked_until }, after: { until, reason: req.body.reason }, ip: req.clientIp });
    });
    return { user: userSummary(findUser(u.public_id), req.auth.user) };
  });

  app.post('/api/admin/users/:publicId/revoke-sessions', {
    onRequest: g.staff,
    schema: { body: { type: 'object', required: ['reason'], properties: { reason: reasonSchema } } },
  }, async (req, reply) => {
    const u = target(req, reply);
    if (!u) return reply;
    transaction(db, () => {
      revokeUserSessions(db, u.id);
      audit(db, { actor: req.auth.user.id, action: 'user.revoke_sessions', target: `user:${u.id}`, after: { reason: req.body.reason }, ip: req.clientIp });
    });
    return { ok: true };
  });

  /** Balance/collection adjustment: always a ledger transaction, never an UPDATE (04-admin §6). */
  app.post('/api/admin/users/:publicId/adjust', {
    onRequest: [g.admin, stepUp],
    schema: {
      body: {
        type: 'object',
        required: ['reason'],
        additionalProperties: false,
        properties: {
          currency: { enum: ['CR', 'PWC'] },
          amount: { type: 'integer', minimum: -1_000_000, maximum: 1_000_000 },
          cards: { type: 'array', maxItems: 60, items: { type: 'object', required: ['uid', 'delta'], additionalProperties: false, properties: { uid: { type: 'string', maxLength: 160 }, delta: { type: 'integer', minimum: -60, maximum: 60 } } } },
          reason: reasonSchema,
        },
      },
    },
  }, async (req, reply) => {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) return reply.code(400).send(apiError('idempotency_required'));
    const u = findUser(req.params.publicId);
    if (!u) return reply.code(404).send(apiError('not_found'));
    // Adjusting one's own account is allowed only for the owner, and it is flagged in the audit trail.
    if (u.id === req.auth.user.id && req.auth.user.role !== 'owner') return reply.code(403).send(apiError('forbidden'));
    if (u.id !== req.auth.user.id && !canActOn(req.auth.user, u)) return reply.code(403).send(apiError('forbidden'));
    const { currency, amount = 0, cards = [], reason } = req.body;
    if (!amount && !cards.length) return reply.code(400).send(apiError('bad_request', 'Nada a ajustar.'));
    if (amount && !currency) return reply.code(400).send({ ...apiError('invalid_value'), field: 'currency' });
    if (req.auth.user.role !== 'owner' && amount) {
      const cap = getSetting(db, 'admin.adjust_cap');
      if (Math.abs(amount) > cap[currency]) return reply.code(403).send(apiError('forbidden', `Ajustes acima de ${cap[currency]} ${currency} exigem o dono do jogo.`));
    }
    for (const c of cards) {
      if (!c.delta) return reply.code(400).send({ ...apiError('invalid_value'), field: 'cards' });
      if (!db.prepare('SELECT 1 FROM card_catalog WHERE uid = ?').get(c.uid)) return reply.code(400).send({ ...apiError('not_found'), uid: c.uid });
    }
    try {
      const entries = amount ? [{ owner: MINT, currency, amount: -amount }, { owner: userOwner(u.id), currency, amount }] : [];
      const { tx, replayed } = transaction(db, () => {
        const res = post(db, {
          kind: 'admin_adjust', key: `admin_adjust:${req.auth.user.id}:${key}`, actor: req.auth.user.id, reason, entries,
          cards: cards.map((c) => ({ userId: u.id, uid: c.uid, delta: c.delta })), meta: { target: u.public_id, currency: currency || null, amount, cards },
        });
        if (!res.replayed) {
          audit(db, { actor: req.auth.user.id, action: u.id === req.auth.user.id ? 'user.adjust.self' : 'user.adjust', target: `user:${u.id}`, after: { tx: res.tx.id, currency: currency || null, amount, cards, reason }, ip: req.clientIp });
        }
        return res;
      });
      return { tx: tx.id, replayed, balances: balances(db, u.id) };
    } catch (err) {
      if (err instanceof EconomyError) return reply.code(err.status).send({ ...apiError(err.code), ...err.details });
      throw err;
    }
  });

  app.post('/api/admin/users/:publicId/role', {
    onRequest: [g.owner, stepUp],
    schema: { body: { type: 'object', required: ['role', 'reason'], additionalProperties: false, properties: { role: { enum: Object.keys(ROLE_RANK) }, reason: reasonSchema } } },
  }, async (req, reply) => {
    const u = target(req, reply);
    if (!u) return reply;
    transaction(db, () => {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, u.id);
      revokeUserSessions(db, u.id); // the session lifetime depends on the role
      audit(db, { actor: req.auth.user.id, action: 'user.role', target: `user:${u.id}`, before: { role: u.role }, after: { role: req.body.role, reason: req.body.reason }, ip: req.clientIp });
    });
    return { user: userSummary(findUser(u.public_id), req.auth.user) };
  });

  // ----------------------------------------------------------------- ledger

  app.get('/api/admin/ledger', {
    onRequest: g.staff,
    schema: { querystring: { type: 'object', properties: { user: { type: 'string', maxLength: 20 }, kind: { type: 'string', maxLength: 40 }, before: { type: 'integer', minimum: 1 } } } },
  }, async (req) => {
    const where = ['t.id < ?'];
    const args = [req.query.before || Number.MAX_SAFE_INTEGER];
    if (req.query.kind) { where.push('t.kind = ?'); args.push(req.query.kind); }
    if (req.query.user) {
      const u = findUser(req.query.user);
      where.push('t.id IN (SELECT e.tx_id FROM ledger_entries e JOIN wallets w ON w.id = e.wallet_id WHERE w.owner = ? UNION SELECT tx_id FROM inventory_moves WHERE user_id = ?)');
      args.push(userOwner(u?.id ?? -1), u?.id ?? -1);
    }
    const rows = db.prepare(`SELECT t.*, a.display_name AS actor FROM ledger_tx t LEFT JOIN users a ON a.id = t.actor_user_id
                             WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT 50`).all(...args);
    return {
      transactions: rows.map((t) => ({ id: t.id, kind: t.kind, actor: t.actor, reason: t.reason, reverses: t.reverses_tx_id, meta: JSON.parse(t.meta || 'null'), createdAt: t.created_at })),
      next: rows.length === 50 ? rows[rows.length - 1].id : null,
    };
  });

  app.get('/api/admin/ledger/:tx', { onRequest: g.staff }, async (req, reply) => {
    const t = db.prepare('SELECT * FROM ledger_tx WHERE id = ?').get(Number(req.params.tx));
    if (!t) return reply.code(404).send(apiError('not_found'));
    const reversedBy = db.prepare('SELECT id FROM ledger_tx WHERE reverses_tx_id = ?').get(t.id)?.id || null;
    return {
      tx: { id: t.id, kind: t.kind, reason: t.reason, reverses: t.reverses_tx_id, reversedBy, meta: JSON.parse(t.meta || 'null'), createdAt: t.created_at },
      entries: db.prepare('SELECT w.owner, w.currency, e.amount FROM ledger_entries e JOIN wallets w ON w.id = e.wallet_id WHERE e.tx_id = ?').all(t.id).map((r) => ({ ...r })),
      cards: db.prepare('SELECT m.user_id AS userId, u.public_id AS publicId, m.card_uid AS uid, m.delta FROM inventory_moves m JOIN users u ON u.id = m.user_id WHERE m.tx_id = ?').all(t.id).map((r) => ({ ...r })),
    };
  });

  /** Reversal: a mirror transaction (RF-2.3); fails if the player already spent what it would take back. */
  app.post('/api/admin/ledger/:tx/reverse', {
    onRequest: [g.admin, stepUp],
    schema: { body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: reasonSchema } } },
  }, async (req, reply) => {
    const t = db.prepare('SELECT * FROM ledger_tx WHERE id = ?').get(Number(req.params.tx));
    if (!t) return reply.code(404).send(apiError('not_found'));
    if (t.kind === 'reversal') return reply.code(400).send(apiError('bad_request', 'Um estorno não pode ser estornado.'));
    try {
      const res = transaction(db, () => {
        const r = reverseTransaction(db, t.id, req.auth.user.id, req.body.reason);
        if (!r.replayed) {
          audit(db, { actor: req.auth.user.id, action: 'ledger.reverse', target: `tx:${t.id}`, after: { reversal: r.tx.id, reason: req.body.reason }, ip: req.clientIp });
          // A reversed trade is shown as such to both players.
          db.prepare("UPDATE trades SET status = 'revertida', resolved_at = ? WHERE tx_id = ?").run(Date.now(), t.id);
        }
        return r;
      });
      if (res.replayed) return reply.code(409).send(apiError('bad_request', 'Esta transação já foi estornada.'));
      return { tx: res.tx.id };
    } catch (err) {
      if (err instanceof EconomyError) return reply.code(err.status).send({ ...apiError(err.code), ...err.details });
      throw err;
    }
  });

  // ------------------------------------------------------------------ audit

  app.get('/api/admin/audit', {
    onRequest: g.staff,
    schema: { querystring: { type: 'object', properties: { action: { type: 'string', maxLength: 60 }, target: { type: 'string', maxLength: 200 }, before: { type: 'integer', minimum: 1 } } } },
  }, async (req) => {
    const where = ['a.id < ?'];
    const args = [req.query.before || Number.MAX_SAFE_INTEGER];
    if (req.query.action) { where.push('a.action LIKE ?'); args.push(`${req.query.action}%`); }
    if (req.query.target) { where.push('a.target = ?'); args.push(req.query.target); }
    const rows = db.prepare(`SELECT a.*, u.display_name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
                             WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 100`).all(...args);
    return {
      entries: rows.map((a) => ({ id: a.id, action: a.action, actor: a.actor, target: a.target, before: JSON.parse(a.before || 'null'), after: JSON.parse(a.after || 'null'), ip: a.ip, createdAt: a.created_at })),
      next: rows.length === 100 ? rows[rows.length - 1].id : null,
    };
  });

  // ------------------------------------------------------------------ rooms

  app.get('/api/admin/rooms', { onRequest: g.staff }, async () => ({
    rooms: [...rooms.rooms.values()].map((r) => ({
      code: r.code,
      name: r.name,
      visibility: r.visibility,
      started: r.started,
      createdAt: r.createdAt,
      seats: r.seats.map((s) => (s ? { name: s.name, connected: s.connected, account: Boolean(s.userId) } : null)),
    })),
  }));

  app.post('/api/admin/rooms/:code/close', {
    onRequest: g.staff,
    schema: { body: { type: 'object', required: ['reason'], properties: { reason: reasonSchema } } },
  }, async (req, reply) => {
    if (!rooms.closeRoom(String(req.params.code), 'admin')) return reply.code(404).send(apiError('room_not_found'));
    audit(db, { actor: req.auth.user.id, action: 'room.close', target: `room:${req.params.code}`, after: { reason: req.body.reason }, ip: req.clientIp });
    return { ok: true };
  });

  // ----------------------------------------------------------------- system

  app.get('/api/admin/health', { onRequest: g.staff }, async () => {
    let dbBytes = null;
    try {
      if (config.dbFile !== ':memory:') dbBytes = fs.statSync(config.dbFile).size;
    } catch { /* not created yet */ }
    return {
      invariants: checkInvariants(db),
      dbBytes,
      migrations: db.prepare('SELECT name, applied_at AS appliedAt FROM schema_migrations ORDER BY name').all().map((r) => ({ ...r })),
      backups: { every: config.backupHours, keep: config.backupKeep, latest: listBackups(config)[0] || null, count: listBackups(config).length },
      version: process.env.APP_VERSION || null,
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
    };
  });
}
