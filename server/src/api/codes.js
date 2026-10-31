import { createHash, randomInt } from 'node:crypto';
import { transaction } from '../db.js';
import { apiError } from '../errors.js';
import { requireUser } from '../auth/session.js';
import { audit } from '../auth/users.js';
import { adminGuards, stepUp } from '../admin/guards.js';
import { balances, EconomyError, MINT, post, userOwner } from '../economy/ledger.js';
import { KeyedLimiter } from '../ratelimit.js';
import { CODE_ALPHABET } from '../rooms.js';

export const REDEEM_CODE_LENGTH = 12;
const hashCode = (code) => createHash('sha256').update(code).digest('hex');

/** XXXX-XXXX-XXXX from the room-code alphabet (no look-alike characters). */
export function makeRedeemCode() {
  let code = '';
  for (let i = 0; i < REDEEM_CODE_LENGTH; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function normalizeRedeemCode(value) {
  if (typeof value !== 'string') return '';
  const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== REDEEM_CODE_LENGTH || [...code].some((ch) => !CODE_ALPHABET.includes(ch))) return '';
  return code;
}

const pretty = (code) => code.match(/.{4}/g).join('-');

/** Grants a code's reward (kind redeem, from system:mint): one use per account, max_uses per code. */
export function redeemCode(db, user, code, now = Date.now()) {
  const codeHash = hashCode(code);
  return transaction(db, () => {
    const row = db.prepare(`SELECT c.*, b.reward, b.max_uses, b.expires_at, b.disabled_at, b.name FROM redeem_codes c
                            JOIN redeem_batches b ON b.id = c.batch_id WHERE c.code_hash = ?`).get(codeHash);
    if (!row || row.disabled_at !== null || (row.expires_at !== null && row.expires_at <= now)) throw new EconomyError('code_invalid', 404);
    if (db.prepare('SELECT 1 FROM redeem_uses WHERE code_hash = ? AND user_id = ?').get(codeHash, user.id)) throw new EconomyError('code_used', 409);
    if (row.uses >= row.max_uses) throw new EconomyError('code_invalid', 404);
    const reward = JSON.parse(row.reward);
    const entries = [];
    for (const [currency, amount] of [['PWC', reward.pwc || 0], ['CR', reward.cr || 0]]) {
      if (amount > 0) entries.push({ owner: MINT, currency, amount: -amount }, { owner: userOwner(user.id), currency, amount });
    }
    const res = post(db, {
      kind: 'redeem', key: `redeem:${codeHash}:${user.id}`, actor: user.id, entries,
      cards: (reward.cards || []).map((c) => ({ userId: user.id, uid: c.uid, delta: c.qty })),
      meta: { batch: row.batch_id, name: row.name, ...reward },
    });
    db.prepare('UPDATE redeem_codes SET uses = uses + 1 WHERE code_hash = ?').run(codeHash);
    db.prepare('INSERT INTO redeem_uses (code_hash, user_id, tx_id, created_at) VALUES (?, ?, ?, ?)').run(codeHash, user.id, res.tx.id, now);
    return { tx: res.tx, reward, name: row.name };
  });
}

/** Redeem codes: players redeem, admins issue batches (docs/sdd/02-economia.md §5.5). */
export function registerCodeRoutes(app, { db, config }) {
  const auth = requireUser(db, config);
  const g = adminGuards(db, config);
  // Failed attempts only (RF-2.18): 5 per minute per account, 20 per hour per address.
  const perUser = new KeyedLimiter(5 / 60, 5);
  const perIp = new KeyedLimiter(20 / 3600, 20);

  app.post('/api/me/redeem', {
    onRequest: auth,
    schema: { body: { type: 'object', required: ['code'], additionalProperties: false, properties: { code: { type: 'string', maxLength: 40 } } } },
  }, async (req, reply) => {
    const userKey = String(req.auth.user.id);
    if (perUser.blocked(userKey) || perIp.blocked(req.clientIp)) return reply.code(429).send(apiError('too_many_attempts', 'Muitas tentativas de código. Aguarde um pouco.'));
    const fail = (status, code) => {
      perUser.take(userKey);
      perIp.take(req.clientIp);
      return reply.code(status).send(apiError(code));
    };
    const code = normalizeRedeemCode(req.body.code);
    if (!code) return fail(404, 'code_invalid');
    try {
      const { tx, reward, name } = redeemCode(db, req.auth.user, code);
      return { tx: tx.id, name, reward, balances: balances(db, req.auth.user.id) };
    } catch (err) {
      if (err instanceof EconomyError && (err.code === 'code_invalid' || err.code === 'code_used')) return fail(err.status, err.code);
      throw err;
    }
  });

  const rewardSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      pwc: { type: 'integer', minimum: 0, maximum: 100000 },
      cr: { type: 'integer', minimum: 0, maximum: 1000000 },
      cards: { type: 'array', maxItems: 20, items: { type: 'object', required: ['uid', 'qty'], additionalProperties: false, properties: { uid: { type: 'string', maxLength: 160 }, qty: { type: 'integer', minimum: 1, maximum: 60 } } } },
    },
  };

  app.get('/api/admin/codes', { onRequest: g.staff }, async () => ({
    batches: db.prepare(`SELECT b.*, u.display_name AS creator, (SELECT COALESCE(SUM(uses), 0) FROM redeem_codes WHERE batch_id = b.id) AS used
                         FROM redeem_batches b LEFT JOIN users u ON u.id = b.created_by ORDER BY b.id DESC`).all()
      .map((b) => ({ id: b.id, name: b.name, reward: JSON.parse(b.reward), codes: b.codes_count, maxUses: b.max_uses, used: b.used, expiresAt: b.expires_at, disabledAt: b.disabled_at, creator: b.creator, createdAt: b.created_at })),
  }));

  /** Creates a batch and returns its codes this one time; only their hashes are kept (RF-2.17). */
  app.post('/api/admin/codes', {
    onRequest: [g.admin, stepUp],
    schema: {
      body: {
        type: 'object',
        required: ['name', 'count', 'reward'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 3, maxLength: 80 },
          count: { type: 'integer', minimum: 1, maximum: 1000 },
          maxUses: { type: 'integer', minimum: 1, maximum: 100000 },
          expiresAt: { type: ['integer', 'null'], minimum: 1 },
          reward: rewardSchema,
        },
      },
    },
  }, async (req, reply) => {
    const { name, count, maxUses = 1, expiresAt = null, reward } = req.body;
    if (!reward.pwc && !reward.cr && !(reward.cards || []).length) return reply.code(400).send(apiError('bad_request', 'A recompensa está vazia.'));
    for (const c of reward.cards || []) {
      if (!db.prepare('SELECT 1 FROM card_catalog WHERE uid = ? AND orphan = 0').get(c.uid)) return reply.code(400).send({ ...apiError('not_found'), uid: c.uid });
    }
    const now = Date.now();
    const codes = [];
    const id = transaction(db, () => {
      const batchId = Number(db.prepare('INSERT INTO redeem_batches (name, reward, codes_count, max_uses, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(name, JSON.stringify(reward), count, maxUses, expiresAt, req.auth.user.id, now).lastInsertRowid);
      while (codes.length < count) {
        const code = makeRedeemCode();
        const res = db.prepare('INSERT OR IGNORE INTO redeem_codes (code_hash, batch_id) VALUES (?, ?)').run(hashCode(code), batchId);
        if (res.changes) codes.push(pretty(code));
      }
      audit(db, { actor: req.auth.user.id, action: 'codes.create', target: `batch:${batchId}`, after: { name, count, maxUses, expiresAt, reward }, ip: req.clientIp });
      return batchId;
    });
    return { id, name, codes };
  });

  app.post('/api/admin/codes/:id/disable', {
    onRequest: g.admin,
    schema: { body: { type: 'object', required: ['reason'], properties: { reason: { type: 'string', minLength: 3, maxLength: 300 } } } },
  }, async (req, reply) => {
    const res = db.prepare('UPDATE redeem_batches SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL').run(Date.now(), Number(req.params.id));
    if (!res.changes) return reply.code(404).send(apiError('not_found'));
    audit(db, { actor: req.auth.user.id, action: 'codes.disable', target: `batch:${req.params.id}`, after: { reason: req.body.reason }, ip: req.clientIp });
    return { ok: true };
  });
}
