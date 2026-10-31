import { transaction } from '../db.js';
import { apiError } from '../errors.js';
import { cleanText, MAX_NAME } from '../protocol.js';
import { requireUser, revokeSession, revokeUserSessions, SESSION_COOKIE } from '../auth/session.js';
import { audit, profile } from '../auth/users.js';
import { balances, userOwner } from '../economy/ledger.js';

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

  app.get('/api/me', { onRequest: auth }, async (req) => {
    const { user, csrfToken } = req.auth;
    return { ...profile(user), csrfToken, features: features() };
  });

  app.patch('/api/me', {
    onRequest: auth,
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

  app.post('/api/auth/logout', { onRequest: auth }, async (req, reply) => {
    revokeSession(db, req.auth.idHash);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/logout-all', { onRequest: auth }, async (req, reply) => {
    revokeUserSessions(db, req.auth.user.id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me/sessions', { onRequest: auth }, async (req) => {
    const rows = db.prepare('SELECT id_hash, created_at, expires_at, user_agent FROM sessions WHERE user_id = ? ORDER BY created_at DESC').all(req.auth.user.id);
    return { sessions: rows.map((r) => ({ current: r.id_hash === req.auth.idHash, createdAt: r.created_at, expiresAt: r.expires_at, userAgent: r.user_agent })) };
  });

  /**
   * Everything kept about the account (LGPD art. 18 II/V; pentest N-15). Other players appear only
   * by their public id, never by name or e-mail.
   */
  app.get('/api/me/export', { onRequest: auth }, async (req, reply) => {
    const { user } = req.auth;
    const id = user.id;
    const all = (sql, ...args) => db.prepare(sql).all(...args).map((r) => ({ ...r }));
    const json = (text) => { try { return JSON.parse(text); } catch { return text; } };
    reply.header('Content-Disposition', 'attachment; filename="mop-meus-dados.json"');
    return {
      exportedAt: new Date().toISOString(),
      account: {
        ...profile(user), email: user.email, googleSub: user.google_sub, avatarUrl: user.avatar_url, status: user.status,
        createdAt: user.created_at, lastLoginAt: user.last_login_at, adultConfirmedAt: user.adult_confirmed_at,
      },
      decks: db.prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY updated_at DESC').all(id).map(deckView),
      wallet: balances(db, id),
      // No `reason`: on staff adjustments it is an internal note about the case (pentest NV-2).
      ledger: all(`SELECT t.id AS tx, t.kind, w.currency, e.amount, t.created_at AS createdAt
                   FROM ledger_entries e JOIN wallets w ON w.id = e.wallet_id JOIN ledger_tx t ON t.id = e.tx_id
                   WHERE w.owner = ? ORDER BY t.id`, userOwner(id)),
      collection: all('SELECT card_uid AS uid, quantity FROM user_cards WHERE user_id = ? AND quantity > 0 ORDER BY card_uid', id),
      wishlist: all('SELECT card_uid AS uid, qty FROM wishlist WHERE user_id = ?', id),
      trades: all(`SELECT t.public_id AS id, CASE WHEN t.from_user = ? THEN 'enviada' ELSE 'recebida' END AS direction,
                   o.public_id AS otherPlayer, t.offer, t.request, t.status, t.created_at AS createdAt
                   FROM trades t JOIN users o ON o.id = CASE WHEN t.from_user = ? THEN t.to_user ELSE t.from_user END
                   WHERE t.from_user = ? OR t.to_user = ? ORDER BY t.id`, id, id, id, id)
        .map((t) => ({ ...t, offer: json(t.offer), request: json(t.request) })),
      matches: all(`SELECT room_code AS room, CASE WHEN p0_user = ? THEN 0 ELSE 1 END AS mySeat, winner_seat AS winnerSeat,
                    turns, duration_ms AS durationMs, status, rewarded, created_at AS createdAt
                    FROM match_results WHERE p0_user = ? OR p1_user = ? ORDER BY id`, id, id, id),
      redeemedCodes: all('SELECT tx_id AS tx, created_at AS createdAt FROM redeem_uses WHERE user_id = ?', id),
      packs: all('SELECT product_id AS product, version, cards, pity, created_at AS createdAt FROM pack_openings WHERE user_id = ?', id)
        .map((p) => ({ ...p, cards: json(p.cards) })),
      sessions: all('SELECT created_at AS createdAt, expires_at AS expiresAt, ip, user_agent AS userAgent FROM sessions WHERE user_id = ?', id),
      // Security log: what was done to the account and the account's own actions. The IP only when the
      // holder did it: a staff member's address is theirs, not the holder's (pentest NV-2).
      audit: all(`SELECT action, CASE WHEN target = ? THEN target ELSE NULL END AS target,
                  CASE WHEN actor_user_id = ? THEN ip ELSE NULL END AS ip,
                  CASE WHEN actor_user_id = ? THEN 'você' ELSE 'equipe do jogo' END AS byWhom, created_at AS createdAt
                  FROM audit_log WHERE target = ? OR actor_user_id = ? ORDER BY id`, `user:${id}`, id, id, `user:${id}`, id),
    };
  });

  app.delete('/api/me', {
    onRequest: auth,
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

  app.get('/api/me/decks', { onRequest: auth }, async (req) => {
    const rows = db.prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY updated_at DESC').all(req.auth.user.id);
    return { decks: rows.map(deckView) };
  });

  app.put('/api/me/decks/:id', { onRequest: auth }, async (req, reply) => {
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

  app.delete('/api/me/decks/:id', { onRequest: auth }, async (req) => {
    db.prepare('DELETE FROM decks WHERE user_id = ? AND id = ?').run(req.auth.user.id, String(req.params.id));
    return { ok: true };
  });

  /** First login: decks kept in this browser's localStorage are copied to the account (RF-1.11). */
  app.post('/api/me/decks/import', {
    onRequest: auth,
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
