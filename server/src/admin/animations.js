import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { transaction } from '../db.js';
import { apiError } from '../errors.js';
import { audit } from '../auth/users.js';
import { adminGuards, ADMINS } from './guards.js';
import { securityHeaders } from '../headers.js';

export const MAX_ANIMATION_BYTES = 1024 * 1024; // per file (CA-3.5)
export const DEFAULT_CROP = { x: 8.5, y: 11.5, w: 83, h: 42 }; // art window, same as scripts/anim/crop.mjs
const TOKEN_PREFIX = 'mop_';
const MEDIA_FILE = /^[a-f0-9]{16}\/[a-f0-9]{16}\.(webm|mp4|webp)$/;
const MEDIA_TYPES = { '.webm': 'video/webm', '.mp4': 'video/mp4', '.webp': 'image/webp' };

const sha256 = (v) => createHash('sha256').update(v).digest('hex');

/** Magic bytes of the three accepted formats (never trust the declared type). */
export function sniff(buf) {
  if (buf.length > 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  if (buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// ------------------------------------------------------------- API tokens

/** Personal API token of an operator script (scopes such as animations:write). Only the hash is stored. */
export function createApiToken(db, userId, { scopes, label, days = 30 }) {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const now = Date.now();
  db.prepare('INSERT INTO api_tokens (user_id, token_hash, scopes, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, sha256(token), scopes.join(' '), label || null, now, now + days * 86_400_000);
  return token;
}

/** User behind "Authorization: Bearer mop_..." when the token is live, has the scope and its owner is still admin. */
export function readApiToken(db, header, scope) {
  const m = /^Bearer (mop_[A-Za-z0-9_-]{20,100})$/.exec(header || '');
  if (!m) return null;
  const row = db.prepare(`SELECT t.scopes, t.expires_at, t.revoked_at, u.* FROM api_tokens t JOIN users u ON u.id = t.user_id
                          WHERE t.token_hash = ?`).get(sha256(m[1]));
  if (!row || row.revoked_at !== null || row.expires_at <= Date.now()) return null;
  if (!row.scopes.split(' ').includes(scope) || row.status !== 'active' || !ADMINS.includes(row.role)) return null;
  const { scopes: _s, expires_at: _e, revoked_at: _r, ...user } = row;
  return user;
}

// ------------------------------------------------------------------ media

function mediaRoot(config) {
  return path.join(config.dataDir, 'media', 'anim');
}

/** Stores one validated file under media/anim/<card hash>/<content hash>.<ext>; returns its public path. */
function storeFile(config, uid, buf, ext) {
  const dir = sha256(uid).slice(0, 16);
  const name = `${sha256(buf).slice(0, 16)}.${ext}`;
  const full = path.join(mediaRoot(config), dir);
  fs.mkdirSync(full, { recursive: true });
  fs.writeFileSync(path.join(full, name), buf, { flag: 'w' });
  return `/media/anim/${dir}/${name}`;
}

/** Approved animations by card for the public catalog (only with the flag on and consent granted). */
export function approvedAnimations(db, config) {
  if (!config.features.has('animations')) return new Map();
  const rows = db.prepare(`SELECT a.card_uid, a.files, a.crop FROM animations a JOIN card_catalog k ON k.uid = a.card_uid
                           WHERE a.status = 'aprovada' AND k.animation_consent = 'concedido'`).all();
  return new Map(rows.map((r) => {
    const f = JSON.parse(r.files);
    return [r.card_uid, { webm: f.webm, mp4: f.mp4, poster: f.poster, crop: JSON.parse(r.crop) }];
  }));
}

const view = (a) => ({
  id: a.id,
  uid: a.card_uid,
  name: a.name,
  status: a.status,
  files: JSON.parse(a.files),
  provenance: a.provenance ? JSON.parse(a.provenance) : null,
  crop: JSON.parse(a.crop),
  reason: a.reason,
  consent: a.animation_consent,
  rarity: a.rarity,
  createdAt: a.created_at,
  reviewedAt: a.reviewed_at,
});

/**
 * Animation pipeline endpoints (03-animacoes §3.5, 04-admin §8):
 *   GET  /media/anim/<dir>/<file>                    served from DATA_DIR/media (immutable)
 *   POST /api/admin/animations/:uid                  upload (admin session or token with animations:write)
 *   GET  /api/admin/animations                       review queue
 *   POST /api/admin/animations/:id/{approve,reject,archive}
 *   GET|POST|DELETE /api/admin/tokens                operator tokens (owner)
 */
export function registerAnimations(app, { db, config }) {
  const g = adminGuards(db, config);

  app.get('/media/anim/*', async (req, reply) => {
    const rel = req.params['*'];
    if (!MEDIA_FILE.test(rel)) return reply.code(404).send(apiError('not_found'));
    const file = path.join(mediaRoot(config), rel);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return reply.code(404).send(apiError('not_found'));
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      ...securityHeaders(config),
      'Content-Type': MEDIA_TYPES[path.extname(file)],
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    pipeline(fs.createReadStream(file), reply.raw, () => {});
    return reply;
  });

  /** Upload: admin session (with CSRF) or operator token; the token path is what scripts/anim/push.mjs uses. */
  async function uploader(req, reply) {
    if (req.headers.authorization) {
      const user = readApiToken(db, req.headers.authorization, 'animations:write');
      if (!user) return reply.code(401).send(apiError('unauthenticated'));
      req.auth = { user, authTime: 0, viaToken: true };
      return undefined;
    }
    return g.admin(req, reply);
  }

  const b64 = { type: 'string', maxLength: Math.ceil((MAX_ANIMATION_BYTES * 4) / 3) + 8 };
  app.post('/api/admin/animations/:uid', {
    onRequest: uploader,
    bodyLimit: 4 * 1024 * 1024 + 64 * 1024,
    schema: {
      body: {
        type: 'object',
        required: ['webm', 'mp4', 'poster'],
        additionalProperties: false,
        properties: {
          webm: b64,
          mp4: b64,
          poster: b64,
          crop: { type: 'object', additionalProperties: false, properties: { x: { type: 'number', minimum: 0, maximum: 100 }, y: { type: 'number', minimum: 0, maximum: 100 }, w: { type: 'number', minimum: 1, maximum: 100 }, h: { type: 'number', minimum: 1, maximum: 100 } } },
          provenance: { type: 'object', maxProperties: 10 },
        },
      },
    },
  }, async (req, reply) => {
    const card = db.prepare('SELECT uid, animation_consent FROM card_catalog WHERE uid = ?').get(req.params.uid);
    if (!card) return reply.code(404).send(apiError('not_found'));
    if (card.animation_consent !== 'concedido') return reply.code(409).send(apiError('no_consent'));
    const files = {};
    let bytes = 0;
    for (const [field, ext] of [['webm', 'webm'], ['mp4', 'mp4'], ['poster', 'webp']]) {
      const buf = Buffer.from(req.body[field], 'base64');
      if (!buf.length || buf.length > MAX_ANIMATION_BYTES) return reply.code(422).send({ ...apiError('animation_invalid', `Arquivo ${field} vazio ou acima de 1 MB.`), field });
      if (sniff(buf) !== ext) return reply.code(422).send({ ...apiError('animation_invalid', `Arquivo ${field} não é ${ext}.`), field });
      bytes += buf.length;
      files[field] = storeFile(config, card.uid, buf, ext);
    }
    files.bytes = bytes;
    const crop = { ...DEFAULT_CROP, ...(req.body.crop || {}) };
    const provenance = JSON.stringify(req.body.provenance || {}).slice(0, 4000);
    const id = transaction(db, () => {
      const res = db.prepare(`INSERT INTO animations (card_uid, status, files, provenance, crop, created_by, created_at)
                              VALUES (?, 'revisao', ?, ?, ?, ?, ?)`).run(card.uid, JSON.stringify(files), provenance, JSON.stringify(crop), req.auth.user.id, Date.now());
      audit(db, { actor: req.auth.user.id, action: 'animation.upload', target: `card:${card.uid}`, after: { animation: Number(res.lastInsertRowid), bytes, viaToken: Boolean(req.auth.viaToken) }, ip: req.clientIp });
      return Number(res.lastInsertRowid);
    });
    return { id, status: 'revisao', files };
  });

  app.get('/api/admin/animations', { onRequest: g.staff }, async () => ({
    animations: db.prepare(`SELECT a.*, k.name, k.rarity, k.animation_consent FROM animations a JOIN card_catalog k ON k.uid = a.card_uid
                            WHERE a.status <> 'arquivada' ORDER BY CASE a.status WHEN 'revisao' THEN 0 WHEN 'aprovada' THEN 1 ELSE 2 END, a.id DESC`).all().map(view),
  }));

  function review(action) {
    return async (req, reply) => {
      const result = transaction(db, () => {
        const a = db.prepare('SELECT a.*, k.animation_consent FROM animations a JOIN card_catalog k ON k.uid = a.card_uid WHERE a.id = ?').get(Number(req.params.id));
        if (!a) return { status: 404, body: apiError('not_found') };
        const now = Date.now();
        if (action === 'approve') {
          if (a.animation_consent !== 'concedido') return { status: 409, body: apiError('no_consent') };
          // The previous approved clip of the card is archived (one approved per card).
          db.prepare("UPDATE animations SET status = 'arquivada' WHERE card_uid = ? AND status = 'aprovada' AND id <> ?").run(a.card_uid, a.id);
          db.prepare("UPDATE animations SET status = 'aprovada', reviewed_by = ?, reviewed_at = ?, reason = NULL WHERE id = ?").run(req.auth.user.id, now, a.id);
          db.prepare('UPDATE card_catalog SET animation_id = ? WHERE uid = ?').run(a.id, a.card_uid);
        } else {
          const status = action === 'reject' ? 'rejeitada' : 'arquivada';
          db.prepare('UPDATE animations SET status = ?, reviewed_by = ?, reviewed_at = ?, reason = ? WHERE id = ?').run(status, req.auth.user.id, now, req.body?.reason || null, a.id);
          db.prepare('UPDATE card_catalog SET animation_id = NULL WHERE uid = ? AND animation_id = ?').run(a.card_uid, a.id);
        }
        audit(db, { actor: req.auth.user.id, action: `animation.${action}`, target: `card:${a.card_uid}`, before: { status: a.status }, after: { animation: a.id, reason: req.body?.reason || null }, ip: req.clientIp });
        return { status: 200, body: { ok: true } };
      });
      return reply.code(result.status).send(result.body);
    };
  }
  const reasonBody = { body: { type: 'object', properties: { reason: { type: 'string', maxLength: 300 } } } };
  app.post('/api/admin/animations/:id/approve', { onRequest: g.admin }, review('approve'));
  app.post('/api/admin/animations/:id/reject', { onRequest: g.admin, schema: reasonBody }, review('reject'));
  app.post('/api/admin/animations/:id/archive', { onRequest: g.admin, schema: reasonBody }, review('archive'));

  // ------------------------------------------------------------- tokens

  app.get('/api/admin/tokens', { onRequest: g.owner }, async () => ({
    tokens: db.prepare(`SELECT t.id, t.label, t.scopes, t.created_at AS createdAt, t.expires_at AS expiresAt, t.revoked_at AS revokedAt, u.display_name AS owner
                        FROM api_tokens t JOIN users u ON u.id = t.user_id ORDER BY t.id DESC`).all().map((r) => ({ ...r })),
  }));

  app.post('/api/admin/tokens', {
    onRequest: g.owner,
    schema: { body: { type: 'object', required: ['label'], additionalProperties: false, properties: { label: { type: 'string', minLength: 2, maxLength: 60 }, days: { type: 'integer', minimum: 1, maximum: 90 } } } },
  }, async (req) => {
    const token = transaction(db, () => {
      const t = createApiToken(db, req.auth.user.id, { scopes: ['animations:write'], label: req.body.label, days: req.body.days || 30 });
      audit(db, { actor: req.auth.user.id, action: 'token.create', target: 'token', after: { label: req.body.label, scopes: ['animations:write'] }, ip: req.clientIp });
      return t;
    });
    return { token, scopes: ['animations:write'], note: 'Copie agora: o token não será mostrado de novo.' };
  });

  app.delete('/api/admin/tokens/:id', { onRequest: g.owner }, async (req) => {
    transaction(db, () => {
      db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(Date.now(), Number(req.params.id));
      audit(db, { actor: req.auth.user.id, action: 'token.revoke', target: `token:${req.params.id}`, ip: req.clientIp });
    });
    return { ok: true };
  });

}
