import { randomBytes } from 'node:crypto';
import net from 'node:net';
import Fastify from 'fastify';
import { WebSocketServer } from 'ws';
import { loadConfig } from './config.js';
import { migrate, openDb } from './db.js';
import { Bucket, KeyedLimiter } from './ratelimit.js';
import { RoomManager } from './rooms.js';
import { serveStatic } from './static.js';
import { cleanText, normalizeCode, parseMessage, ERRORS, PROTOCOL_VERSION, MAX_NAME, MAX_ROOM_NAME } from './protocol.js';

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
  const db = openDb(config.dbFile);
  migrate(db);
  const rooms = new RoomManager(config);
  const ipConnections = new Map();
  const joinFailures = new Map(); // ip -> { count, resetAt }
  const apiLimiter = new KeyedLimiter(config.apiRateLimitPerSecond, config.apiRateLimitBurst);

  const app = Fastify({
    logger: false,
    bodyLimit: config.apiBodyBytes,
    // The client address comes from clientIp(), which applies TRUST_PROXY / CLIENT_IP_HEADER.
    trustProxy: false,
    return503OnClosing: true,
  });
  app.decorate('mop', { config, db, rooms });

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
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
  });

  wss.on('connection', (ws, _req, ip) => {
    ipConnections.set(ip, (ipConnections.get(ip) || 0) + 1);
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
      if (session && session.transport === send) rooms.disconnect(session);
    });

    function handleHandshake(msg) {
      if (msg.type === 'hello') {
        if (Number(msg.protocol || PROTOCOL_VERSION) !== PROTOCOL_VERSION) {
          fail('version');
          return;
        }
        session = rooms.createSession({ name: cleanText(msg.name, MAX_NAME) || 'Hacker', ip, transport: send });
        send({ type: 'welcome', id: session.id, token: session.token, protocol: PROTOCOL_VERSION });
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
          const result = rooms.createRoom(session, {
            name: cleanText(msg.name, MAX_ROOM_NAME),
            visibility: msg.visibility === 'private' ? 'private' : 'public',
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

/** API error body: { error: code, message: text in pt-BR } (docs/sdd/00-arquitetura.md §5). */
export function apiError(code, message) {
  return { error: code, message: message || ERRORS[code] || code };
}

function dbAlive(db) {
  try {
    return db.prepare('SELECT 1 AS ok').get().ok === 1;
  } catch {
    return false;
  }
}
