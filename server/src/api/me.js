import { transaction } from '../db.js';
import { apiError } from '../errors.js';
import { cleanText, MAX_NAME } from '../protocol.js';
import { requireUser, revokeSession, revokeUserSessions, SESSION_COOKIE } from '../auth/session.js';
import { audit, profile } from '../auth/users.js';

export const MAX_DECKS = 100;
const MAX_DECK_CARDS = 60;
const MAX_DECK_NAME = 40;
const DECK_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Validates a deck sent by the client: {id, name, cards:[{uid, amount}]} (src/stores/decks.js format).
 * Returns { deck } or { error }. Ownership of the cards is not checked here (that is F2, collection mode).
 */
export function parseDeck(input, idFromUrl) {
  if (!input || typeof input !== 'object') return { error: 'deck_invalid' };
  const id = idFromUrl ?? input.id;
  if (typeof id !== 'string' || !DECK_ID.test(id)) return { error: 'deck_invalid' };
  const name = cleanText(input.name, MAX_DECK_NAME);
  if (!name || !Array.isArray(input.cards) || input.cards.length > MAX_DECK_CARDS) return { error: 'deck_invalid' };
  const merged = new Map();
  let total = 0;
  for (const e of input.cards) {
    if (!e || typeof e !== 'object' || typeof e.uid !== 'string' || !e.uid || e.uid.length > 160) return { error: 'deck_invalid' };
    if (!Number.isInteger(e.amount) || e.amount < 1 || e.amount > MAX_DECK_CARDS) return { error: 'deck_invalid' };
    total += e.amount;
    merged.set(e.uid, (merged.get(e.uid) || 0) + e.amount);
  }
  if (total > MAX_DECK_CARDS) return { error: 'deck_invalid' };
  return { deck: { id, name, cards: [...merged].map(([uid, amount]) => ({ uid, amount })) } };
}

const deckView = (row) => ({ id: row.id, name: row.name, cards: JSON.parse(row.cards), imported: Boolean(row.imported), updatedAt: row.updated_at });

/** /api/me*: profile, sessions, LGPD export/deletion and account decks (docs/sdd/01-login-google.md §5). */
export function registerAccountRoutes(app, { db, config }) {
  const auth = requireUser(db, config);
  const features = () => [...config.features];

  app.get('/api/me', { preHandler: auth }, async (req) => {
    const { user, csrfToken } = req.auth;
    return { ...profile(user), csrfToken, features: features() };
  });

  app.patch('/api/me', {
    preHandler: auth,
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { displayName: { type: 'string', maxLength: 64 }, showAvatar: { type: 'boolean' }, adultConfirmed: { type: 'boolean', const: true } },
      },
    },
  }, async (req, reply) => {
    const { user } = req.auth;
    const changes = {};
    if (req.body.displayName !== undefined) {
      const name = cleanText(req.body.displayName, MAX_NAME);
      if (!name) return reply.code(400).send(apiError('bad_request', 'Apelido inválido.'));
      changes.display_name = name;
    }
    if (req.body.showAvatar !== undefined) changes.show_avatar = req.body.showAvatar ? 1 : 0;
    if (req.body.adultConfirmed && user.adult_confirmed_at === null) changes.adult_confirmed_at = Date.now();
    const keys = Object.keys(changes);
    if (keys.length) {
      db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => changes[k]), user.id);
    }
    return profile(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
  });

  app.post('/api/auth/logout', { preHandler: auth }, async (req, reply) => {
    revokeSession(db, req.auth.idHash);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/logout-all', { preHandler: auth }, async (req, reply) => {
    revokeUserSessions(db, req.auth.user.id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me/sessions', { preHandler: auth }, async (req) => {
    const rows = db.prepare('SELECT id_hash, created_at, expires_at, user_agent FROM sessions WHERE user_id = ? ORDER BY created_at DESC').all(req.auth.user.id);
    return { sessions: rows.map((r) => ({ current: r.id_hash === req.auth.idHash, createdAt: r.created_at, expiresAt: r.expires_at, userAgent: r.user_agent })) };
  });

  app.get('/api/me/export', { preHandler: auth }, async (req, reply) => {
    const { user } = req.auth;
    const decks = db.prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY updated_at DESC').all(user.id).map(deckView);
    reply.header('Content-Disposition', 'attachment; filename="mop-meus-dados.json"');
    return {
      exportedAt: new Date().toISOString(),
      account: { ...profile(user), email: user.email, lastLoginAt: user.last_login_at },
      decks,
    };
  });

  app.delete('/api/me', {
    preHandler: auth,
    schema: { body: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'string', maxLength: 64 } } } },
  }, async (req, reply) => {
    const { user } = req.auth;
    if (cleanText(req.body.confirm, MAX_NAME) !== user.display_name) return reply.code(400).send(apiError('confirm_mismatch'));
    // Personal data goes; the row stays so ledger entries and trades keep pointing at something.
    transaction(db, () => {
      db.prepare('DELETE FROM decks WHERE user_id = ?').run(user.id);
      db.prepare(`UPDATE users SET google_sub = NULL, email = NULL, avatar_url = NULL, show_avatar = 0,
                  display_name = 'Jogador removido', status = 'deleted' WHERE id = ?`).run(user.id);
      revokeUserSessions(db, user.id);
      audit(db, { actor: user.id, action: 'user.delete', target: `user:${user.id}`, ip: req.clientIp });
    });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ------------------------------------------------------------------ decks

  app.get('/api/me/decks', { preHandler: auth }, async (req) => {
    const rows = db.prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY updated_at DESC').all(req.auth.user.id);
    return { decks: rows.map(deckView) };
  });

  app.put('/api/me/decks/:id', { preHandler: auth }, async (req, reply) => {
    const { deck, error } = parseDeck(req.body, req.params.id);
    if (error) return reply.code(400).send(apiError(error));
    const userId = req.auth.user.id;
    const now = Date.now();
    const result = transaction(db, () => {
      const exists = db.prepare('SELECT 1 FROM decks WHERE user_id = ? AND id = ?').get(userId, deck.id);
      if (!exists && db.prepare('SELECT count(*) AS n FROM decks WHERE user_id = ?').get(userId).n >= MAX_DECKS) return 'too_many_decks';
      db.prepare(`INSERT INTO decks (id, user_id, name, cards, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
                  ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name, cards = excluded.cards, updated_at = excluded.updated_at`)
        .run(deck.id, userId, deck.name, JSON.stringify(deck.cards), now, now);
      return '';
    });
    if (result) return reply.code(409).send(apiError(result));
    return deckView(db.prepare('SELECT * FROM decks WHERE user_id = ? AND id = ?').get(userId, deck.id));
  });

  app.delete('/api/me/decks/:id', { preHandler: auth }, async (req) => {
    db.prepare('DELETE FROM decks WHERE user_id = ? AND id = ?').run(req.auth.user.id, String(req.params.id));
    return { ok: true };
  });

  /** First login: decks kept in this browser's localStorage are copied to the account (RF-1.11). */
  app.post('/api/me/decks/import', {
    preHandler: auth,
    schema: { body: { type: 'object', required: ['decks'], properties: { decks: { type: 'array', maxItems: MAX_DECKS } } } },
  }, async (req, reply) => {
    const userId = req.auth.user.id;
    const parsed = [];
    for (const input of req.body.decks) {
      const { deck } = parseDeck(input);
      if (deck) parsed.push(deck);
    }
    const now = Date.now();
    const imported = transaction(db, () => {
      let room = MAX_DECKS - db.prepare('SELECT count(*) AS n FROM decks WHERE user_id = ?').get(userId).n;
      let count = 0;
      for (const deck of parsed) {
        if (room <= 0) break;
        const res = db.prepare(`INSERT INTO decks (id, user_id, name, cards, imported, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)
                                ON CONFLICT (user_id, id) DO NOTHING`).run(deck.id, userId, deck.name, JSON.stringify(deck.cards), now, now);
        if (res.changes) {
          count += 1;
          room -= 1;
        }
      }
      return count;
    });
    return { imported, skipped: req.body.decks.length - imported };
  });
}
