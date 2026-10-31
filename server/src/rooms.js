import { randomBytes, randomInt } from 'node:crypto';

/** Room codes avoid look-alike characters (0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const SEATS = 2;

export function makeCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** A player connection. Survives socket drops for `reconnectGraceMs` (resume by token). */
export class Session {
  constructor({ name, ip, transport }) {
    this.id = randomBytes(6).toString('hex');
    this.token = randomBytes(24).toString('base64url');
    this.name = name;
    this.ip = ip;
    this.transport = transport; // (msg: object) => void, null while disconnected
    this.room = null;
    this.seat = -1;
    this.subscribed = false;
    this.buffer = [];
    this.bufferBytes = 0;
    this.awayTimer = null;
  }

  get connected() {
    return this.transport !== null;
  }
}

/**
 * Lobby and relay logic, independent from the socket layer so it can be unit tested.
 * Rooms hold two seats; seat 0 is the room creator and the authoritative game host.
 */
export class RoomManager {
  constructor(config) {
    this.config = config;
    this.rooms = new Map(); // code -> room
    this.sessions = new Map(); // token -> session
    this._lobbyTimer = null;
    this.totalBufferedBytes = 0; // bytes queued for every disconnected session
  }

  _clearBuffer(session) {
    this.totalBufferedBytes -= session.bufferBytes;
    session.bufferBytes = 0;
    session.buffer = [];
  }

  /** Drops a session for good: nobody can resume it afterwards. */
  _forget(session) {
    this._clearBuffer(session);
    clearTimeout(session.awayTimer);
    session.awayTimer = null;
    this.sessions.delete(session.token);
  }

  // ---------------------------------------------------------------- sessions

  createSession({ name, ip, transport }) {
    const session = new Session({ name, ip, transport });
    this.sessions.set(session.token, session);
    return session;
  }

  findByToken(token) {
    return typeof token === 'string' ? this.sessions.get(token) || null : null;
  }

  deliver(session, msg) {
    if (session.connected) {
      session.transport(msg);
      return true;
    }
    if (session.room === null) return false;
    session.buffer.push(msg);
    const size = msg.type === 'relay' && typeof msg.data === 'string' ? msg.data.length * 2 : 256;
    session.bufferBytes += size;
    this.totalBufferedBytes += size;
    if (
      session.buffer.length > this.config.maxBufferedMessages
      || session.bufferBytes > this.config.maxBufferedBytes
      || this.totalBufferedBytes > this.config.maxTotalBufferedBytes
    ) {
      // Too far behind to catch up: give the seat up and forget the session (nothing left to resume).
      this.leaveRoom(session, 'overflow');
      this._forget(session);
    }
    return false;
  }

  /** Socket closed without an explicit leave: keep the seat for a while. */
  disconnect(session) {
    session.transport = null;
    session.subscribed = false;
    if (session.room === null) {
      this.sessions.delete(session.token);
      return;
    }
    const other = this._other(session);
    if (other) this.deliver(other, { type: 'peer_away', seat: session.seat });
    clearTimeout(session.awayTimer);
    session.awayTimer = setTimeout(() => {
      this.leaveRoom(session, 'timeout');
      this._forget(session); // also drops what was queued after the host closed the room
    }, this.config.reconnectGraceMs);
    session.awayTimer.unref?.();
  }

  /** Re-attaches a new socket to a session that was disconnected. */
  resume(session, transport) {
    clearTimeout(session.awayTimer);
    session.awayTimer = null;
    session.transport = transport;
    const pending = session.buffer;
    this._clearBuffer(session);
    if (session.room) {
      transport({ type: 'resumed', room: this.roomView(session.room), seat: session.seat });
      for (const msg of pending) transport(msg);
      const other = this._other(session);
      if (other) this.deliver(other, { type: 'peer_back', seat: session.seat });
    } else {
      transport({ type: 'resumed', room: null, seat: -1 });
    }
  }

  // ---------------------------------------------------------------- rooms

  createRoom(session, { name, visibility }) {
    if (session.room) this.leaveRoom(session, 'left');
    if (this.rooms.size >= this.config.maxRooms) return { error: 'server_full' };
    if (this.config.maxRoomsPerIp) {
      let mine = 0;
      for (const r of this.rooms.values()) if (r.seats[0] && r.seats[0].ip === session.ip) mine += 1;
      if (mine >= this.config.maxRoomsPerIp) return { error: 'server_full' };
    }
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    const room = {
      code,
      name: name || `Sala de ${session.name}`,
      visibility: visibility === 'private' ? 'private' : 'public',
      createdAt: Date.now(),
      seats: [session, null],
      started: false,
    };
    this.rooms.set(code, room);
    session.room = room;
    session.seat = 0;
    session.subscribed = false;
    this._lobbyChanged(room);
    return { room };
  }

  joinRoom(session, code) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'room_not_found' };
    if (session.room === room) return { room };
    // The host already streamed this match to its guest: a seat freed mid-game is not up for grabs.
    // The original guest gets back in with `resume` (its token) while the grace period lasts.
    if (room.started) return { error: 'room_started' };
    const seat = room.seats.findIndex((s) => s === null);
    if (seat === -1) return { error: 'room_full' };
    if (session.room) this.leaveRoom(session, 'left');
    // Two seats with the same visible name make the chat, the log and the turn banners ambiguous.
    const peer = room.seats.find((s) => s !== null && s !== session);
    if (peer && peer.name.toLowerCase() === session.name.toLowerCase()) session.name = `${session.name.slice(0, 20)} (2)`;
    room.seats[seat] = session;
    session.room = room;
    session.seat = seat;
    session.subscribed = false;
    const other = this._other(session);
    if (other) this.deliver(other, { type: 'peer_joined', player: this._playerView(session) });
    this._lobbyChanged(room);
    return { room };
  }

  leaveRoom(session, reason = 'left') {
    const room = session.room;
    if (!room) return;
    room.seats[session.seat] = null;
    const seat = session.seat;
    session.room = null;
    session.seat = -1;
    this._clearBuffer(session);
    clearTimeout(session.awayTimer);
    session.awayTimer = null;
    const remaining = room.seats.filter(Boolean);
    if (remaining.length === 0) {
      this.rooms.delete(room.code);
    } else {
      for (const s of remaining) this.deliver(s, { type: 'peer_left', seat, reason });
      // A room that lost its host can't continue (the host is authoritative).
      if (seat === 0) {
        for (const s of remaining) {
          this.deliver(s, { type: 'room_closed', reason: 'host_left' });
          s.room = null;
          s.seat = -1;
        }
        this.rooms.delete(room.code);
      }
    }
    this._lobbyChanged(room);
  }

  markStarted(session) {
    if (session.room && session.seat === 0) {
      session.room.started = true;
      this._lobbyChanged(session.room);
    }
  }

  /** Forwards an opaque game payload to the other seat. Returns false when alone. */
  relay(session, data) {
    const other = this._other(session);
    if (!other) return false;
    this.deliver(other, { type: 'relay', from: session.seat, data });
    return true;
  }

  // ---------------------------------------------------------------- views

  publicRooms() {
    const out = [];
    for (const room of this.rooms.values()) {
      if (room.visibility !== 'public' || room.started) continue;
      if (room.seats[1] !== null || room.seats[0] === null) continue;
      out.push({
        code: room.code,
        name: room.name,
        host: room.seats[0].name,
        createdAt: room.createdAt,
        players: 1,
      });
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out.slice(0, 100);
  }

  roomView(room) {
    return {
      code: room.code,
      name: room.name,
      visibility: room.visibility,
      started: room.started,
      players: room.seats.map((s, seat) => (s ? this._playerView(s, seat) : null)),
    };
  }

  stats() {
    return { rooms: this.rooms.size, sessions: this.sessions.size, publicRooms: this.publicRooms().length };
  }

  dispose() {
    clearTimeout(this._lobbyTimer);
    for (const s of this.sessions.values()) clearTimeout(s.awayTimer);
  }

  _playerView(session, seat = session.seat) {
    return { name: session.name, seat, connected: session.connected };
  }

  _other(session) {
    const room = session.room;
    if (!room) return null;
    return room.seats.find((s) => s !== null && s !== session) || null;
  }

  _lobbyChanged(room) {
    if (room.visibility !== 'public') return;
    if (this._lobbyTimer) return;
    this._lobbyTimer = setTimeout(() => {
      this._lobbyTimer = null;
      const rooms = this.publicRooms();
      for (const s of this.sessions.values()) {
        if (s.subscribed && s.connected && s.room === null) s.transport({ type: 'rooms', rooms });
      }
    }, 150);
    this._lobbyTimer.unref?.();
  }
}
