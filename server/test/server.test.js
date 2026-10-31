import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../src/server.js';

let server;
let base;
let staticDir;

before(async () => {
  staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mop-web-'));
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<html>jogo</html>');
  fs.writeFileSync(path.join(staticDir, 'game.wasm'), 'wasm');
  server = createServer({ staticDir, dbFile: ':memory:', rateLimitBurst: 400, joinFailuresPerMinute: 3, reconnectGraceMs: 2000 });
  const addr = await server.listen(0, '127.0.0.1');
  base = `127.0.0.1:${addr.port}`;
});

after(async () => {
  await server.close();
  fs.rmSync(staticDir, { recursive: true, force: true });
});

/** Small promise-based client. */
async function client(name, { hello = true, origin } = {}) {
  const ws = new WebSocket(`ws://${base}/ws`, origin ? { origin } : {});
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.pred(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const c = {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    next(type, timeout = 2000) {
      const pred = (m) => !type || m.type === type;
      const i = queue.findIndex(pred);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => {
          const k = waiters.indexOf(w);
          if (k >= 0) {
            waiters.splice(k, 1);
            reject(new Error(`timeout waiting for ${type}`));
          }
        }, timeout);
      });
    },
    close: () => ws.close(),
  };
  if (hello) {
    c.send({ type: 'hello', name, protocol: 1 });
    c.welcome = await c.next('welcome');
  }
  return c;
}

test('serves the web build and health endpoints', async () => {
  const index = await fetch(`http://${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /jogo/);
  const wasm = await fetch(`http://${base}/game.wasm`);
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  const cfg = await (await fetch(`http://${base}/config.json`)).json();
  assert.equal(cfg.server_url, '');
  const health = await (await fetch(`http://${base}/health`)).json();
  assert.equal(health.ok, true);
  const traversal = await fetch(`http://${base}/..%2f..%2fetc%2fpasswd`);
  assert.ok([403, 404].includes(traversal.status));
});

test('full flow: public room, listing, join, relay, leave', async () => {
  const host = await client('Ana');
  const guest = await client('Bia');
  guest.send({ type: 'list' });
  assert.deepEqual((await guest.next('rooms')).rooms, []);
  host.send({ type: 'create', name: 'Mesa 1', visibility: 'public' });
  const joined = await host.next('joined');
  assert.equal(joined.seat, 0);
  const code = joined.room.code;
  const update = await guest.next('rooms');
  assert.equal(update.rooms[0].code, code);
  assert.equal(update.rooms[0].host, 'Ana');
  const api = await (await fetch(`http://${base}/api/rooms`)).json();
  assert.equal(api.rooms[0].name, 'Mesa 1');
  guest.send({ type: 'join', code: code.toLowerCase() });
  assert.equal((await guest.next('joined')).seat, 1);
  assert.equal((await host.next('peer_joined')).player.name, 'Bia');
  host.send({ type: 'relay', data: 'abc' });
  assert.deepEqual(await guest.next('relay'), { type: 'relay', from: 0, data: 'abc' });
  guest.send({ type: 'relay', data: 'def' });
  assert.equal((await host.next('relay')).data, 'def');
  guest.send({ type: 'leave' });
  await guest.next('left');
  assert.equal((await host.next('peer_left')).seat, 1);
  host.close();
  guest.close();
});

test('private rooms are hidden and joinable by code', async () => {
  const host = await client('Host');
  const watcher = await client('Watcher');
  watcher.send({ type: 'list' });
  await watcher.next('rooms');
  host.send({ type: 'create', visibility: 'private' });
  const { room } = await host.next('joined');
  await new Promise((r) => setTimeout(r, 300));
  const api = await (await fetch(`http://${base}/api/rooms`)).json();
  assert.ok(!api.rooms.some((r) => r.code === room.code));
  watcher.send({ type: 'join', code: room.code });
  assert.equal((await watcher.next('joined')).room.visibility, 'private');
  host.close();
  watcher.close();
});

test('reconnect with token keeps the seat and delivers missed messages', async () => {
  const host = await client('H');
  const guest = await client('G');
  host.send({ type: 'create', visibility: 'private' });
  const { room } = await host.next('joined');
  guest.send({ type: 'join', code: room.code });
  await guest.next('joined');
  await host.next('peer_joined');
  guest.ws.terminate();
  await host.next('peer_away');
  host.send({ type: 'relay', data: 'missed-1' });
  const again = await client('G', { hello: false });
  again.send({ type: 'resume', token: guest.welcome.token });
  const resumed = await again.next('resumed');
  assert.equal(resumed.seat, 1);
  assert.equal((await again.next('relay')).data, 'missed-1');
  await host.next('peer_back');
  host.close();
  again.close();
});

test('rejects bad input, big payloads and code brute force', async () => {
  const c = await client('Evil');
  c.send({ type: 'relay', data: 'x' });
  assert.equal((await c.next('error')).code, 'not_in_room');
  c.ws.send('not json');
  assert.equal((await c.next('error')).code, 'bad_request');
  c.send({ type: 'nope' });
  assert.equal((await c.next('error')).code, 'bad_request');
  for (let i = 0; i < 3; i += 1) {
    c.send({ type: 'join', code: 'ZZZZZZ' });
    assert.equal((await c.next('error')).code, 'room_not_found');
  }
  c.send({ type: 'join', code: 'ZZZZZZ' });
  assert.equal((await c.next('error')).code, 'too_many_attempts');
  c.send({ type: 'create', visibility: 'private' });
  await c.next('joined');
  c.send({ type: 'relay', data: 'x'.repeat(server.config.maxRelayBytes + 1) });
  assert.equal((await c.next('error')).code, 'payload_too_large');
  c.close();
  const anon = await client('', { hello: false });
  anon.send({ type: 'list' });
  assert.equal((await anon.next('error')).code, 'not_ready');
  anon.close();
});

/** Sends a raw HTTP request (lets the test use targets fetch() would normalize). */
function rawRequest(target) {
  return new Promise((resolve, reject) => {
    const [host, port] = base.split(':');
    const sock = net.connect(Number(port), host, () => sock.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
    let data = '';
    sock.on('data', (d) => { data += d; });
    sock.on('end', () => resolve(data));
    sock.on('error', reject);
  });
}

test('api: JSON errors, odd request targets and health db flag', async () => {
  const missing = await fetch(`http://${base}/api/nope`);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('cache-control'), 'no-store');
  assert.equal((await missing.json()).error, 'not_found');
  assert.match(await rawRequest('//'), /^HTTP\/1\.1 400/);
  const post = await fetch(`http://${base}/index.html`, { method: 'POST' });
  assert.equal(post.status, 404);
  const health = await (await fetch(`http://${base}/health`)).json();
  assert.equal(health.db, true);
});

test('api: per-address rate limit', async () => {
  const limited = createServer({ staticDir, dbFile: ':memory:', apiRateLimitPerSecond: 1, apiRateLimitBurst: 3 });
  const addr = await limited.listen(0, '127.0.0.1');
  const statuses = [];
  for (let i = 0; i < 5; i += 1) statuses.push((await fetch(`http://127.0.0.1:${addr.port}/api/rooms`)).status);
  await limited.close();
  assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
  assert.equal(statuses[4], 429);
});

test('N-4 security headers: page CSP on HTML, locked-down CSP on API, health and 404', async () => {
  const page = await fetch(`http://${base}/`);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  for (const url of ['/api/features', '/health', '/api/nada', '/nada.txt']) {
    const res = await fetch(`http://${base}${url}`);
    assert.match(res.headers.get('content-security-policy') || '', /default-src 'none'.*sandbox/, url);
    assert.equal(res.headers.get('x-frame-options'), 'DENY', url);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url);
  }
  const wasm = await fetch(`http://${base}/game.wasm`);
  assert.equal(wasm.headers.get('x-frame-options'), 'DENY');
  // Plain HTTP: no HSTS.
  assert.equal(page.headers.get('strict-transport-security'), null);
});
