import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import { WebSocketServer } from 'ws';
import { loadConfig } from './config.js';
import { registerAccountRoutes } from './api/me.js';
import { registerShopRoutes } from './api/shop.js';
import { registerCodeRoutes } from './api/codes.js';
import { registerPackRoutes } from './api/packs.js';
import { registerTradeRoutes } from './api/trades.js';
import { applyFlagOverrides, registerAdmin } from './admin/admin.js';
import { registerAdminCatalog } from './admin/catalog.js';
import { registerGoogleAuth } from './auth/google.js';
import { purgeExpiredSessions, readSession, SESSION_COOKIE } from './auth/session.js';
import { migrate, openDb } from './db.js';
import { loadLibrary, starterCollection, syncCatalog } from './economy/catalog.js';
import { grantMissingSignups } from './economy/grants.js';
import { Bucket, KeyedLimiter } from './ratelimit.js';
import { RoomManager } from './rooms.js';
import { apiError } from './errors.js';
import { serveStatic } from './static.js';
import { cleanText, normalizeCode, parseMessage, ERRORS, PROTOCOL_VERSION, SUPPORTED_PROTOCOLS, MAX_NAME, MAX_ROOM_NAME } from './protocol.js';
import { settleMatch, validateCollectionDeck } from './economy/matches.js';

/** URL parsing that never throws: a request target such as "//" makes `new URL(raw, base)` throw. */
function safeUrl(raw) {
  try {
    return new URL(raw, 'http://x');
  } catch {
    return null;
  }
}

/**
 * Creates the HTTP + WebSocket server.
 *   GET  /            web build of the game (STATIC_DIR)
 *   GET  /health      liveness + counters
 *   GET  /api/rooms   public rooms waiting for a player
 *   *    /api/...     JSON API (accounts, economy, admin; docs/sdd/)
 *   WS   /ws          lobby + relay protocol (see README)
 */
export function createServer(overrides = {}) {
  const config = loadConfig(overrides);
  const accounts = config.features.has('accounts');
  if (accounts) checkAccountsConfig(config);
  const db = openDb(config.dbFile);
  migrate(db);
  let starter = [];
  if (accounts) {
    applyFlagOverrides(db, config);
    // The catalog overlay follows the built card list (cards/ itself is never touched).
    const library = loadLibrary(config);
    if (library) {
      syncCatalog(db, library);
      starter = starterCollection(library, JSON.parse(fs.readFileSync(config.starterDecksFile, 'utf8')));
      grantMissingSignups(db, starter);
    } else {
      console.warn('[mop-server] AVISO: cards.json não encontrado; catálogo e kit inicial desativados');
    }
  }
  const rooms = new RoomManager(config);
  const ipConnections = new Map();
  const joinFailures = new Map(); // ip -> { count, resetAt }
  const accountConnections = new Map(); // user id -> open sockets
  const apiLimiter = new KeyedLimiter(config.apiRateLimitPerSecond, config.apiRateLimitBurst);

  const app = Fastify({
    logger: false,
    bodyLimit: config.apiBodyBytes,
    // The client address comes from clientIp(), which applies TRUST_PROXY / CLIENT_IP_HEADER.
    trustProxy: false,
    return503OnClosing: true,
  });
  app.decorate('mop', { config, db, rooms });
  // Signs the short-lived OAuth state cookie. Without accounts nothing is signed: any secret will do.
  app.register(fastifyCookie, { secret: config.sessionSecret || randomBytes(32).toString('hex') });
  app.register(async (api) => {
    api.get('/api/features', async () => ({ features: [...config.features] }));
    if (!accounts) return;
    registerGoogleAuth(api, { db, config, starter });
    registerAccountRoutes(api, { db, config });
    registerShopRoutes(api, { db, config });
    registerTradeRoutes(api, { db, config });
    registerCodeRoutes(api, { db, config });
    registerPackRoutes(api, { db, config });
    registerAdminCatalog(api, { db, config });
    registerAdmin(api, { db, config, rooms });
  });

  app.addHook('onRequest', async (req, reply) => {
    // A request target such as "//" must get a 400, not reach the router or the static handler.
    if (!safeUrl(req.raw.url)) return reply.code(400).type('text/plain; charset=utf-8').send('Bad request');
    req.clientIp = clientIp(req.raw);
    if (req.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
      if (!apiLimiter.take(req.clientIp)) return reply.code(429).send(apiError('rate_limited'));
    }
    return undefined;
  });

  app.setErrorHandler((err, _req, reply) => {
    const status = err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) console.error('[mop-server] erro na API:', err);
    const code = status === 413 ? 'payload_too_large' : status === 500 ? 'internal' : 'bad_request';
    reply.code(status).send(apiError(code));
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send(apiError('not_found'));
    reply.hijack();
    if (!serveStatic(req.raw, reply.raw, config)) {
      reply.raw.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
    return undefined;
  });

  app.get('/health', async (_req, reply) => {
    reply.header('Cache-Control', 'no-cache').header('X-Content-Type-Options', 'nosniff');
    return { ok: true, protocol: PROTOCOL_VERSION, db: dbAlive(db), ...rooms.stats() };
  });

  app.get('/api/rooms', async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    return { rooms: rooms.publicRooms() };
  });

  const httpServer = app.server;

  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes, perMessageDeflate: false });

  function clientIp(req) {
    const peer = req.socket.remoteAddress || 'unknown';
    if (config.clientIpHeader) {
      // A platform that overwrites this header itself (Fly-Client-IP on Fly.io) is the best source.
      const v = String(req.headers[config.clientIpHeader] || '').trim();
      return net.isIP(v) ? v : peer;
    }
    const hops = config.trustProxy === true ? 1 : Number(config.trustProxy) || 0;
    if (!hops) return peer;
    // Each trusted proxy appends the address it saw, so count from the right: whatever is left of
    // that came from the client and can be forged.
    const fwd = req.headers['x-forwarded-for'];
    const parts = typeof fwd === 'string' ? fwd.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const candidate = parts[parts.length - hops];
    return candidate && net.isIP(candidate) ? candidate : peer;
  }

  httpServer.on('upgrade', (req, socket, head) => {
    // A reset or malformed socket must only take this connection down, never the process.
    socket.on('error', () => {});
    const url = safeUrl(req.url);
    const reject = (status, text) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (!url) return reject(400, 'Bad Request');
    if (url.pathname !== '/ws') return reject(404, 'Not Found');
    const origin = req.headers.origin;
    // Native clients (desktop/mobile builds) send no Origin; browsers always do.
    if (origin && config.allowedOrigins.length && !config.allowedOrigins.includes(origin)) {
      return reject(403, 'Forbidden');
    }
    if (wss.clients.size >= config.maxClients) return reject(503, 'Service Unavailable');
    const ip = clientIp(req);
    if ((ipConnections.get(ip) || 0) >= config.maxClientsPerIp) return reject(429, 'Too Many Requests');
    // Same-origin page with a session cookie: the lobby session is tied to the account.
    const account = accounts ? readSession(db, app.parseCookie(req.headers.cookie || '')[SESSION_COOKIE])?.user || null : null;
    if (account && (accountConnections.get(account.id) || 0) >= config.maxClientsPerAccount) return reject(429, 'Too Many Requests');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip, account));
  });

  wss.on('connection', (ws, _req, ip, account) => {
    ipConnections.set(ip, (ipConnections.get(ip) || 0) + 1);
    if (account) accountConnections.set(account.id, (accountConnections.get(account.id) || 0) + 1);
    const bucket = new Bucket(config.rateLimitPerSecond, config.rateLimitBurst);
    const byteBucket = new Bucket(config.rateLimitBytesPerSecond, config.rateLimitBurstBytes);
    // ws re-emits frame errors (oversize, bad UTF-8, bad opcode, too many fragments) here and already
    // closes the connection with the right status; without a listener the error crashes the process.
    ws.on('error', () => {});
    let session = null;
    let alive = true;
    const send = (msg) => {
      if (ws.readyState !== ws.OPEN) return;
      if (ws.bufferedAmount > config.maxSocketBacklogBytes) {
        ws.terminate(); // the peer stopped reading: don't queue megabytes for it
        return;
      }
      ws.send(JSON.stringify(msg));
    };
    const fail = (code) => send({ type: 'error', code, message: ERRORS[code] || code });

    // Only a pong that echoes our latest ping counts: RFC 6455 allows unsolicited pongs, which would
    // otherwise keep a peer that stopped reading connected forever.
    let pingNonce = null;
    ws.on('pong', (data) => {
      if (pingNonce && data.equals(pingNonce)) {
        alive = true;
        pingNonce = null;
      }
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      pingNonce = randomBytes(8);
      ws.ping(pingNonce); // browsers and ws echo the ping payload in their pong
    }, config.heartbeatMs);

    ws.on('message', (raw, isBinary) => {
      if (!bucket.take() || !byteBucket.take(raw.length)) {
        fail('rate_limited');
        return;
      }
      if (isBinary) {
        fail('bad_request');
        return;
      }
      const msg = parseMessage(raw.toString('utf8'));
      if (!msg) {
        fail('bad_request');
        return;
      }
      if (session === null) {
        handleHandshake(msg);
        return;
      }
      handle(msg);
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      const left = (ipConnections.get(ip) || 1) - 1;
      if (left <= 0) ipConnections.delete(ip);
      else ipConnections.set(ip, left);
      if (account) {
        const open = (accountConnections.get(account.id) || 1) - 1;
        if (open <= 0) accountConnections.delete(account.id);
        else accountConnections.set(account.id, open);
      }
      if (session && session.transport === send) rooms.disconnect(session);
    });

    function handleHandshake(msg) {
      if (msg.type === 'hello') {
        const protocol = Number(msg.protocol || 1);
        if (!SUPPORTED_PROTOCOLS.includes(protocol)) {
          fail('version');
          return;
        }
        // Logged-in players always show their account name; the name sent by the client is ignored.
        const name = account ? account.display_name : cleanText(msg.name, MAX_NAME) || 'Hacker';
        session = rooms.createSession({ name, ip, transport: send });
        session.userId = account ? account.id : null;
        const welcome = { type: 'welcome', id: session.id, token: session.token, protocol };
        if (account) welcome.account = { publicId: account.public_id, displayName: account.display_name };
        send(welcome);
        return;
      }
      if (msg.type === 'resume') {
        const existing = rooms.findByToken(msg.token);
        if (!existing) {
          fail('bad_token');
          return;
        }
        if (existing.connected && existing.transport !== send) {
          // An older socket is still attached: it is superseded by this one.
          const old = existing.transport;
          existing.transport = null;
          old({ type: 'error', code: 'bad_token', message: 'Sessão aberta em outra conexão.' });
        }
        session = existing;
        rooms.resume(session, send);
        return;
      }
      if (msg.type === 'ping') {
        send({ type: 'pong' });
        return;
      }
      fail('not_ready');
    }

    /** Collection room: the server validates the account deck; the host gets both canonical lists. */
    function handleDeck(msg) {
      const room = session.room;
      if (!room) return fail('not_in_room');
      if (room.mode !== 'colecao') return fail('not_collection_room');
      if (room.started) return fail('room_started');
      const { deck, error, problems } = validateCollectionDeck(db, session.userId, msg.deckId);
      if (error) {
        room.decks[session.seat] = null;
        send({ type: 'error', code: error, message: ERRORS[error], problems });
        return undefined;
      }
      room.decks[session.seat] = { userId: session.userId, ...deck };
      rooms.broadcast(room, { type: 'deck_ok', seat: session.seat, name: deck.name, count: deck.list.length });
      if (room.decks[0] && room.decks[1] && room.seats[0]) {
        rooms.deliver(room.seats[0], { type: 'decks', lists: room.decks.map((d) => d.list), names: room.decks.map((d) => d.name) });
      }
      return undefined;
    }

    /** Collection room: both seats report the winner; rewards only when they agree (RF-2.21). */
    function handleResult(msg) {
      const room = session.room;
      if (!room || room.mode !== 'colecao' || !room.startedAt || !room.decks[0] || !room.decks[1]) return undefined;
      const winnerSeat = Number(msg.winnerSeat);
      const turns = Number(msg.turns);
      if (![-1, 0, 1].includes(winnerSeat) || !Number.isInteger(turns) || turns < 0 || turns > 1000) return fail('bad_request');
      if (room.reports[session.seat]) return undefined;
      room.reports[session.seat] = { winnerSeat, turns };
      if (!room.reports[0] || !room.reports[1]) return undefined;
      const result = settleMatch(db, { code: room.code, users: room.decks.map((d) => d.userId), reports: room.reports, startedAt: room.startedAt });
      room.startedAt = null; // one settlement per started match
      room.seats.forEach((s, seat) => {
        if (s) rooms.deliver(s, { type: 'match_result', status: result.status, reward: result.rewards.find((r) => r.seat === seat)?.amount || 0 });
      });
      return undefined;
    }

    function tooManyJoinFailures() {
      const now = Date.now();
      const entry = joinFailures.get(ip);
      return entry && entry.resetAt > now && entry.count >= config.joinFailuresPerMinute;
    }

    function recordJoinFailure() {
      const now = Date.now();
      const entry = joinFailures.get(ip);
      if (!entry || entry.resetAt <= now) joinFailures.set(ip, { count: 1, resetAt: now + 60_000 });
      else entry.count += 1;
    }

    function handle(msg) {
      switch (msg.type) {
        case 'ping':
          send({ type: 'pong' });
          break;
        case 'rename': {
          if (session.userId) break; // account names change through PATCH /api/me
          const name = cleanText(msg.name, MAX_NAME) || session.name;
          const other = session.room?.seats.find((s) => s !== null && s !== session);
          session.name = other && other.name.toLowerCase() === name.toLowerCase() ? `${name.slice(0, MAX_NAME - 4)} (2)` : name;
          break;
        }
        case 'list':
          session.subscribed = true;
          send({ type: 'rooms', rooms: rooms.publicRooms() });
          break;
        case 'unsubscribe':
          session.subscribed = false;
          break;
        case 'create': {
          const mode = msg.mode === 'colecao' ? 'colecao' : 'livre';
          if (mode === 'colecao' && !session.userId) {
            fail('account_required');
            break;
          }
          const result = rooms.createRoom(session, {
            name: cleanText(msg.name, MAX_ROOM_NAME),
            visibility: msg.visibility === 'private' ? 'private' : 'public',
            mode,
          });
          if (result.error) fail(result.error);
          else send({ type: 'joined', room: rooms.roomView(result.room), seat: session.seat });
          break;
        }
        case 'join': {
          if (tooManyJoinFailures()) {
            fail('too_many_attempts');
            break;
          }
          const code = normalizeCode(msg.code);
          const result = code ? rooms.joinRoom(session, code) : { error: 'room_not_found' };
          if (result.error) {
            // Every failed join counts (full or started rooms too), or a known code can be polled
            // without limit while waiting for a seat to free up.
            recordJoinFailure();
            fail(result.error);
          } else {
            send({ type: 'joined', room: rooms.roomView(result.room), seat: session.seat });
          }
          break;
        }
        case 'leave':
          rooms.leaveRoom(session, 'left');
          send({ type: 'left' });
          break;
        case 'started':
          rooms.markStarted(session);
          break;
        case 'deck':
          handleDeck(msg);
          break;
        case 'result':
          handleResult(msg);
          break;
        case 'relay': {
          if (!session.room) {
            fail('not_in_room');
            break;
          }
          if (typeof msg.data !== 'string' || Buffer.byteLength(msg.data) > config.maxRelayBytes) {
            fail(typeof msg.data === 'string' ? 'payload_too_large' : 'bad_request');
            break;
          }
          rooms.relay(session, msg.data);
          break;
        }
        case 'bye':
          // Explicit goodbye: release the seat now instead of waiting for the grace period.
          rooms.leaveRoom(session, 'left');
          rooms.sessions.delete(session.token);
          ws.close(1000);
          break;
        default:
          fail('bad_request');
      }
    }
  });

  const joinSweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of joinFailures) if (entry.resetAt <= now) joinFailures.delete(ip);
    apiLimiter.sweep();
    purgeExpiredSessions(db);
  }, 60_000);
  joinSweep.unref?.();

  return {
    config,
    db,
    rooms,
    app,
    httpServer,
    wss,
    async listen(port = config.port, host = config.host) {
      await app.listen({ port, host });
      return httpServer.address();
    },
    async close() {
      clearInterval(joinSweep);
      rooms.dispose();
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(() => resolve()));
      await app.close();
      db.close();
    },
  };
}

/** Accounts cannot start half configured: a missing secret would only show up at the first login. */
function checkAccountsConfig(config) {
  const missing = [];
  if (!/^https?:\/\//.test(config.publicUrl)) missing.push('PUBLIC_URL');
  if (!config.googleClientId) missing.push('GOOGLE_CLIENT_ID');
  if (!config.googleClientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (config.sessionSecret.length < 32) missing.push('SESSION_SECRET (32+ caracteres)');
  if (missing.length) throw new Error(`FEATURES=accounts exige: ${missing.join(', ')}`);
}

function dbAlive(db) {
  try {
    return db.prepare('SELECT 1 AS ok').get().ok === 1;
  } catch {
    return false;
  }
}
