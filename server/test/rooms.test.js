import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, CODE_ALPHABET, CODE_LENGTH, makeCode } from '../src/rooms.js';
import { cleanText, normalizeCode } from '../src/protocol.js';

const config = { maxRooms: 3, maxBufferedMessages: 5, reconnectGraceMs: 50 };

function player(rooms, name) {
  const inbox = [];
  const session = rooms.createSession({ name, ip: '1.1.1.1', transport: (m) => inbox.push(m) });
  return { session, inbox };
}

test('room codes use the unambiguous alphabet', () => {
  for (let i = 0; i < 200; i += 1) {
    const code = makeCode();
    assert.equal(code.length, CODE_LENGTH);
    for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch));
  }
});

test('public rooms are listed until full; private rooms never', () => {
  const rooms = new RoomManager(config);
  const a = player(rooms, 'Ana');
  const b = player(rooms, 'Bia');
  const c = player(rooms, 'Caio');
  const pub = rooms.createRoom(a.session, { name: 'Pública', visibility: 'public' }).room;
  rooms.createRoom(b.session, { name: 'Secreta', visibility: 'private' });
  assert.deepEqual(rooms.publicRooms().map((r) => r.code), [pub.code]);
  assert.ok(rooms.joinRoom(c.session, pub.code).room);
  assert.equal(rooms.publicRooms().length, 0);
  assert.equal(a.inbox.at(-1).type, 'peer_joined');
  rooms.dispose();
});

test('private room joinable by code; full room rejected', () => {
  const rooms = new RoomManager(config);
  const a = player(rooms, 'A');
  const b = player(rooms, 'B');
  const c = player(rooms, 'C');
  const room = rooms.createRoom(a.session, { name: '', visibility: 'private' }).room;
  assert.equal(room.name, 'Sala de A');
  assert.ok(rooms.joinRoom(b.session, room.code).room);
  assert.equal(rooms.joinRoom(c.session, room.code).error, 'room_full');
  assert.equal(rooms.joinRoom(c.session, 'ZZZZZZ').error, 'room_not_found');
  rooms.dispose();
});

test('relay forwards opaque payloads to the other seat only', () => {
  const rooms = new RoomManager(config);
  const a = player(rooms, 'A');
  const b = player(rooms, 'B');
  const room = rooms.createRoom(a.session, { visibility: 'public' }).room;
  assert.equal(rooms.relay(a.session, 'x'), false, 'alone in the room');
  rooms.joinRoom(b.session, room.code);
  rooms.relay(a.session, 'payload');
  assert.deepEqual(b.inbox.at(-1), { type: 'relay', from: 0, data: 'payload' });
  assert.notEqual(a.inbox.at(-1).type, 'relay');
  rooms.dispose();
});

test('disconnect buffers messages and resume flushes them', () => {
  const rooms = new RoomManager(config);
  const a = player(rooms, 'A');
  const b = player(rooms, 'B');
  const room = rooms.createRoom(a.session, { visibility: 'public' }).room;
  rooms.joinRoom(b.session, room.code);
  rooms.disconnect(b.session);
  assert.equal(a.inbox.at(-1).type, 'peer_away');
  rooms.relay(a.session, 'm1');
  rooms.relay(a.session, 'm2');
  const inbox2 = [];
  rooms.resume(b.session, (m) => inbox2.push(m));
  assert.equal(inbox2[0].type, 'resumed');
  assert.deepEqual(inbox2.slice(1).map((m) => m.data), ['m1', 'm2']);
  assert.equal(a.inbox.at(-1).type, 'peer_back');
  rooms.dispose();
});

test('seat is released after the grace period', async () => {
  const rooms = new RoomManager(config);
  const a = player(rooms, 'A');
  const b = player(rooms, 'B');
  const room = rooms.createRoom(a.session, { visibility: 'public' }).room;
  rooms.joinRoom(b.session, room.code);
  rooms.disconnect(b.session);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(a.inbox.at(-1).type, 'peer_left');
  assert.equal(rooms.findByToken(b.session.token), null);
  rooms.dispose();
});

test('host leaving closes the room for the guest', () => {
  const rooms = new RoomManager(config);
  const a = player(rooms, 'A');
  const b = player(rooms, 'B');
  const room = rooms.createRoom(a.session, { visibility: 'public' }).room;
  rooms.joinRoom(b.session, room.code);
  rooms.leaveRoom(a.session);
  assert.equal(b.inbox.at(-1).type, 'room_closed');
  assert.equal(b.session.room, null);
  assert.equal(rooms.rooms.size, 0);
  rooms.dispose();
});

test('room limit and buffer overflow', () => {
  const rooms = new RoomManager(config);
  for (let i = 0; i < 3; i += 1) rooms.createRoom(player(rooms, `P${i}`).session, { visibility: 'private' });
  assert.equal(rooms.createRoom(player(rooms, 'X').session, {}).error, 'server_full');
  const r2 = new RoomManager(config);
  const a = player(r2, 'A');
  const b = player(r2, 'B');
  const room = r2.createRoom(a.session, { visibility: 'private' }).room;
  r2.joinRoom(b.session, room.code);
  r2.disconnect(b.session);
  for (let i = 0; i < 10; i += 1) r2.relay(a.session, `m${i}`);
  assert.equal(b.session.room, null, 'too far behind: seat released');
  rooms.dispose();
  r2.dispose();
});

test('text sanitization and code normalization', () => {
  assert.equal(cleanText('  Ana‮\u0000 Hacker  ', 24), 'Ana Hacker');
  assert.equal(cleanText('x'.repeat(50), 24).length, 24);
  assert.equal(cleanText(42, 24), '');
  assert.equal(normalizeCode('ab-c2 3d'), 'ABC23D');
  assert.equal(normalizeCode('ABC10D'), '', 'ambiguous chars are not valid codes');
  assert.equal(normalizeCode({}), '');
});
