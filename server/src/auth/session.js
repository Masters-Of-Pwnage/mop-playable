import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { apiError } from '../errors.js';

export const SESSION_COOKIE = 'mop_sid';
const DAY = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * DAY;
export const STAFF_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const STAFF = new Set(['moderator', 'admin', 'owner']);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const ttlFor = (role) => (STAFF.has(role) ? STAFF_SESSION_TTL_MS : SESSION_TTL_MS);

/** Creates a session; only the hash of the token is stored. Returns the raw token for the cookie. */
export function createSession(db, user, { authTime, ip, userAgent }) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare(`INSERT INTO sessions (id_hash, user_id, created_at, expires_at, auth_time, csrf_token, ip, user_agent)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sha256(token), user.id, now, now + ttlFor(user.role), authTime, randomBytes(24).toString('base64url'), ip || null, (userAgent || '').slice(0, 200));
  return token;
}

/** Session + user for a raw token, or null. Sliding expiry: renewed once half of its life has passed. */
export function readSession(db, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const row = db.prepare(`SELECT s.id_hash, s.expires_at, s.auth_time, s.csrf_token, u.*
                          FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`).get(sha256(token));
  const now = Date.now();
  if (!row || row.expires_at <= now) return null;
  if (!isActive(row, now)) return null;
  const ttl = ttlFor(row.role);
  if (row.expires_at - now < ttl / 2) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(now + ttl, row.id_hash);
  }
  const { id_hash: idHash, expires_at: _expires, auth_time: authTime, csrf_token: csrfToken, ...user } = row;
  return { idHash, authTime, csrfToken, user };
}

export function isActive(user, now = Date.now()) {
  if (user.status === 'active') return true;
  return user.status === 'suspended' && user.suspended_until !== null && user.suspended_until <= now;
}

/**
 * 'revoked' (db, { userId } | { idHash }): fired on every revocation (logout, logout-all, ban,
 * suspension, role change, account deletion) so the lobby closes the sockets opened with it.
 */
export const sessionEvents = new EventEmitter();
sessionEvents.setMaxListeners(0); // one listener per server; the tests start many

export function revokeSession(db, idHash) {
  db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
  sessionEvents.emit('revoked', db, { idHash });
}

export function revokeUserSessions(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  sessionEvents.emit('revoked', db, { userId });
}

export function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

export function sessionCookieOptions(config, role = 'player') {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicUrl.startsWith('https://'),
    maxAge: Math.floor(ttlFor(role) / 1000),
  };
}

/** Origins allowed to send API mutations: PUBLIC_URL plus ALLOWED_ORIGINS. */
function allowedOrigins(config) {
  const list = [...config.allowedOrigins];
  if (config.publicUrl) list.push(new URL(config.publicUrl).origin);
  return list;
}

/**
 * Fastify preHandler factory. Loads the session into req.auth; with `csrf` (default for anything
 * but GET/HEAD) also checks the X-CSRF-Token header and the Origin of the request.
 */
export function requireUser(db, config, { roles = null } = {}) {
  return async (req, reply) => {
    const auth = readSession(db, req.cookies?.[SESSION_COOKIE]);
    if (!auth) return reply.code(401).send(apiError('unauthenticated'));
    if (roles && !roles.includes(auth.user.role)) return reply.code(403).send(apiError('forbidden'));
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins(config).includes(origin)) return reply.code(403).send(apiError('bad_origin'));
      if (req.headers['x-csrf-token'] !== auth.csrfToken) return reply.code(403).send(apiError('bad_csrf'));
    }
    req.auth = auth;
    return undefined;
  };
}
