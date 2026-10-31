/**
 * Lobby client for server/ (WebSocket). Handles hello/resume, public room
 * listing, create/join/leave and the opaque relay channel used by the match.
 */
import { reactive } from 'vue';
import { resolveServerUrl, settings } from '../stores/settings.js';

export const PROTOCOL = 1;
const SESSION_KEY = 'mop.session.v1';

export const net = reactive({
  status: 'offline', // offline | connecting | online | error
  error: '',
  rooms: [],
  room: null, // {code, name, visibility, started, players:[{name, seat, connected}|null]}
  seat: -1,
  peerAway: false,
});

let ws = null;
let url = '';
let token = '';
let tokenUrl = ''; // server that issued `token`
let reconnectTimer = null;
let reconnectAttempts = 0;
let wantConnection = false;
const relayListeners = new Set();
const roomListeners = new Set();
let pingTimer = null;

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function loadSession() {
  // A token belongs to the server that issued it: never send it to another URL.
  if (tokenUrl !== url) token = '';
  tokenUrl = url;
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (s && s.url === url && s.token) token = s.token;
  } catch { /* ignore */ }
}

function saveSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ url, token }));
  } catch { /* ignore */ }
}

export async function connect() {
  wantConnection = true;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  url = await resolveServerUrl();
  loadSession();
  net.status = 'connecting';
  net.error = '';
  try {
    ws = new WebSocket(url);
  } catch (err) {
    net.status = 'error';
    net.error = `Endereço do servidor inválido: ${url}`;
    return;
  }
  ws.onopen = () => {
    reconnectAttempts = 0;
    if (token) send({ type: 'resume', token });
    else send({ type: 'hello', name: settings.playerName, protocol: PROTOCOL });
    clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ type: 'ping' }), 20000);
  };
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    handle(msg);
  };
  ws.onclose = () => {
    clearInterval(pingTimer);
    ws = null;
    if (net.status !== 'error') net.status = 'offline';
    if (wantConnection) scheduleReconnect();
  };
  ws.onerror = () => {
    if (net.status === 'connecting') {
      net.status = 'error';
      net.error = 'Não foi possível conectar ao servidor de salas.';
    }
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  const delay = Math.min(15000, 1000 * 2 ** Math.min(reconnectAttempts, 4));
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    if (wantConnection) connect();
  }, delay);
}

export function disconnect() {
  wantConnection = false;
  clearTimeout(reconnectTimer);
  clearInterval(pingTimer);
  if (ws) {
    send({ type: 'bye' });
    ws.close();
  }
  ws = null;
  token = '';
  net.room = null;
  net.seat = -1;
  net.status = 'offline';
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}

function handle(msg) {
  switch (msg.type) {
    case 'welcome':
      token = msg.token;
      saveSession();
      net.status = 'online';
      send({ type: 'list' });
      break;
    case 'resumed':
      net.status = 'online';
      net.room = msg.room;
      net.seat = msg.seat;
      net.peerAway = false;
      if (!msg.room) send({ type: 'list' });
      emitRoom({ type: 'resumed', room: msg.room });
      break;
    case 'rooms':
      net.rooms = msg.rooms || [];
      break;
    case 'joined':
      net.room = msg.room;
      net.seat = msg.seat;
      net.peerAway = false;
      emitRoom(msg);
      break;
    case 'left':
      net.room = null;
      net.seat = -1;
      send({ type: 'list' });
      emitRoom(msg);
      break;
    case 'peer_joined':
      if (net.room) net.room.players[msg.player.seat] = msg.player;
      net.peerAway = false;
      emitRoom(msg);
      break;
    case 'peer_left':
      if (net.room) net.room.players[msg.seat] = null;
      net.peerAway = false;
      emitRoom(msg);
      break;
    case 'peer_away':
      net.peerAway = true;
      emitRoom(msg);
      break;
    case 'peer_back':
      net.peerAway = false;
      emitRoom(msg);
      break;
    case 'room_closed':
      net.room = null;
      net.seat = -1;
      emitRoom(msg);
      send({ type: 'list' });
      break;
    case 'relay':
      for (const fn of relayListeners) fn(msg.data, msg.from);
      break;
    case 'error':
      if (msg.code === 'bad_token') {
        token = '';
        send({ type: 'hello', name: settings.playerName, protocol: PROTOCOL });
        return;
      }
      if (msg.code === 'version') {
        net.status = 'error';
        wantConnection = false;
      }
      net.error = msg.message || msg.code;
      emitRoom(msg);
      break;
    default:
      break;
  }
}

function emitRoom(msg) {
  for (const fn of roomListeners) fn(msg);
}

export const lobby = {
  refresh: () => send({ type: 'list' }),
  rename: (name) => send({ type: 'rename', name }),
  create: (name, visibility) => send({ type: 'create', name, visibility }),
  join: (code) => send({ type: 'join', code }),
  leave: () => send({ type: 'leave' }),
  started: () => send({ type: 'started' }),
  relay: (data) => send({ type: 'relay', data: typeof data === 'string' ? data : JSON.stringify(data) }),
  onRelay(fn) {
    relayListeners.add(fn);
    return () => relayListeners.delete(fn);
  },
  onRoom(fn) {
    roomListeners.add(fn);
    return () => roomListeners.delete(fn);
  },
  get connected() {
    return net.status === 'online';
  },
};
