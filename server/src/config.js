import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

/** Server configuration, overridable through environment variables. */
export function loadConfig(overrides = {}) {
  const config = {
    port: int('PORT', 8787),
    host: process.env.HOST || '0.0.0.0',
    // Built site (npm run build -> dist/). Served at "/".
    staticDir: process.env.STATIC_DIR || path.resolve(here, '../../dist'),
    // Comma separated list of allowed browser origins for the WebSocket. Empty = any.
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Public WebSocket URL advertised in /config.json (empty = same origin as the page).
    publicWsUrl: process.env.PUBLIC_WS_URL || '',
    // Adds COOP/COEP headers (only needed for Godot builds with thread support).
    crossOriginIsolation: process.env.CROSS_ORIGIN_ISOLATION === '1',
    maxClients: int('MAX_CLIENTS', 1000),
    maxClientsPerIp: int('MAX_CLIENTS_PER_IP', 20),
    maxRooms: int('MAX_ROOMS', 500),
    // Rooms one client address may host at once (a room outlives its host for RECONNECT_GRACE_SECONDS).
    maxRoomsPerIp: int('MAX_ROOMS_PER_IP', 5),
    maxMessageBytes: int('MAX_MESSAGE_BYTES', 512 * 1024),
    maxRelayBytes: int('MAX_RELAY_BYTES', 384 * 1024),
    // Seconds a disconnected player keeps their seat (network hiccups, app in background).
    reconnectGraceMs: int('RECONNECT_GRACE_SECONDS', 60) * 1000,
    maxBufferedMessages: int('MAX_BUFFERED_MESSAGES', 1000),
    // Memory ceilings for messages queued for disconnected seats (worst case counted as UTF-16).
    maxBufferedBytes: int('MAX_BUFFERED_BYTES', 8 * 1024 * 1024),
    maxTotalBufferedBytes: int('MAX_TOTAL_BUFFERED_BYTES', 64 * 1024 * 1024),
    // A connected peer that stops reading is dropped once this much is queued on its socket.
    maxSocketBacklogBytes: int('MAX_SOCKET_BACKLOG_BYTES', 4 * 1024 * 1024),
    // Per-connection byte budget (the message bucket alone lets 40 x 384 KiB per second through).
    rateLimitBytesPerSecond: int('RATE_LIMIT_BYTES_PER_SECOND', 2 * 1024 * 1024),
    rateLimitBurstBytes: int('RATE_LIMIT_BURST_BYTES', 8 * 1024 * 1024),
    heartbeatMs: int('HEARTBEAT_SECONDS', 25) * 1000,
    // Token bucket per connection.
    rateLimitPerSecond: int('RATE_LIMIT_PER_SECOND', 40),
    rateLimitBurst: int('RATE_LIMIT_BURST', 120),
    // Failed room-code lookups allowed per IP per minute (code brute force protection).
    joinFailuresPerMinute: int('JOIN_FAILURES_PER_MINUTE', 15),
    // Number of trusted reverse proxies in front of the server (0 = none; TRUST_PROXY=1 keeps working).
    // The client address is read from the right of X-Forwarded-For, the part the client cannot forge.
    trustProxy: int('TRUST_PROXY', 0),
    // Header that holds the client address, written by the platform in front (e.g. Fly-Client-IP).
    // When set it wins over TRUST_PROXY. Only use a header the proxy overwrites, never one it passes along.
    clientIpHeader: (process.env.CLIENT_IP_HEADER || '').trim().toLowerCase(),
    ...overrides,
  };
  return config;
}
