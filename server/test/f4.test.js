// F4: conversion, trades, redeem codes, packs and collection rooms (docs/sdd/02-economia.md §8).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createServer } from '../src/server.js';
import { createSession } from '../src/auth/session.js';
import { upsertGoogleUser } from '../src/auth/users.js';
import { grantSignup } from '../src/economy/grants.js';
import { balances, checkInvariants, MINT, post, userOwner } from '../src/economy/ledger.js';
import { drawPack } from '../src/economy/packs.js';
import { setSetting } from '../src/economy/settings.js';
import { settleMatch } from '../src/economy/matches.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const starter = [{ uid: 'c-common', qty: 1 }, { uid: 'c-land', qty: 12 }];
let server;
let base;
let db;
let seq = 0;

before(async () => {
  server = createServer({
    dbFile: ':memory:',
    staticDir: '/nonexistent',
    cardsFile: path.join(fixtures, 'cards.json'),
    starterDecksFile: path.join(fixtures, 'starter-decks.json'),
    features: new Set(['accounts', 'shop', 'trades']),
    publicUrl: 'http://127.0.0.1',
    googleClientId: 'x',
    googleClientSecret: 'x',
    sessionSecret: 'x'.repeat(40),
    apiRateLimitBurst: 100000,
    apiRateLimitPerSecond: 100000,
  });
  db = server.db;
  const addr = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${addr.port}`;
});

after(() => server.close());

function account(role = 'player', { veteran = false } = {}) {
  seq += 1;
  const { user } = upsertGoogleUser(db, { sub: `f4-${seq}`, given_name: `U${seq}` }, server.config, null, (u) => grantSignup(db, u, starter));
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  if (veteran) makeVeteran(user.id);
  const fresh = () => db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const token = createSession(db, fresh(), { authTime: Date.now() });
  const csrf = db.prepare('SELECT csrf_token FROM sessions WHERE user_id = ?').get(user.id).csrf_token;
  const call = async (method, url, body, extra = {}) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { cookie: `mop_sid=${token}`, 'X-CSRF-Token': csrf, 'Idempotency-Key': `k-${seq}-${Math.random().toString(36).slice(2, 12)}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { user: fresh(), fresh, token, call };
}

/** Old enough and with enough finished matches to trade (RF-2.11). */
function makeVeteran(userId) {
  db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(Date.now() - 30 * 86_400_000, userId);
  const other = db.prepare('SELECT id FROM users WHERE id <> ? LIMIT 1').get(userId)?.id ?? userId;
  for (let i = 0; i < 10; i += 1) {
    db.prepare("INSERT INTO match_results (room_code, p0_user, p1_user, winner_seat, turns, duration_ms, status, created_at) VALUES ('SEED', ?, ?, 0, 9, 600000, 'consenso', ?)")
      .run(userId, other, Date.now() - 20 * 86_400_000);
  }
}

const give = (userId, { cr = 0, pwc = 0, cards = [] } = {}) => post(db, {
  kind: 'admin_adjust', key: `give-${userId}-${Math.random()}`,
  entries: [
    ...(cr ? [{ owner: MINT, currency: 'CR', amount: -cr }, { owner: userOwner(userId), currency: 'CR', amount: cr }] : []),
    ...(pwc ? [{ owner: MINT, currency: 'PWC', amount: -pwc }, { owner: userOwner(userId), currency: 'PWC', amount: pwc }] : []),
  ],
  cards: cards.map((c) => ({ userId, uid: c.uid, delta: c.qty })),
});
const qty = (userId, uid) => db.prepare('SELECT quantity FROM user_cards WHERE user_id = ? AND card_uid = ?').get(userId, uid)?.quantity || 0;

// ------------------------------------------------------------------ conversion

test('RF-2.9 conversion: rate check, daily cap, idempotent', async () => {
  const p = account();
  give(p.user.id, { pwc: 2000 });
  const ok = await p.call('POST', '/api/me/convert', { pwc: 30, expectedRate: 10 }, { 'Idempotency-Key': 'conv-key-123' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.balances, { PWC: 1970, CR: 800 });
  const again = await p.call('POST', '/api/me/convert', { pwc: 30, expectedRate: 10 }, { 'Idempotency-Key': 'conv-key-123' });
  assert.equal(again.body.replayed, true);
  assert.equal(again.body.balances.CR, 800);
  const rate = await p.call('POST', '/api/me/convert', { pwc: 1, expectedRate: 9 });
  assert.equal(rate.body.error, 'rate_changed');
  assert.equal(rate.body.rate, 10);
  const cap = await p.call('POST', '/api/me/convert', { pwc: 971, expectedRate: 10 });
  assert.equal(cap.body.error, 'limit_reached');
  assert.equal(cap.body.left, 970);
  const poor = account();
  assert.equal((await poor.call('POST', '/api/me/convert', { pwc: 1, expectedRate: 10 })).body.error, 'insufficient_funds');
  assert.equal((await p.call('GET', '/api/me/wallet')).body.convertLeftToday, 970);
});

// ---------------------------------------------------------------------- trades

test('CA-2.6 new accounts cannot trade', async () => {
  const fresh = account();
  const vet = account('player', { veteran: true });
  const r = await fresh.call('POST', '/api/trades', { to: vet.user.public_id, offer: { cards: [{ uid: 'c-land', qty: 1 }] }, request: {} });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'trade_locked');
  const r2 = await vet.call('POST', '/api/trades', { to: fresh.user.public_id, offer: { cards: [{ uid: 'c-land', qty: 1 }] }, request: {} });
  assert.equal(r2.body.error, 'trade_peer_locked');
});

test('trade: atomic swap with PwnCoin fee burnt; invariants hold', async () => {
  const a = account('player', { veteran: true });
  const b = account('player', { veteran: true });
  give(a.user.id, { pwc: 100 });
  give(b.user.id, { cards: [{ uid: 'c-legend', qty: 1 }] });
  const created = await a.call('POST', '/api/trades', { to: b.user.public_id, offer: { pwc: 100, cards: [{ uid: 'c-land', qty: 2 }] }, request: { cards: [{ uid: 'c-legend', qty: 1 }] } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.trade.status, 'aberta');
  const inbox = await b.call('GET', '/api/trades?box=in');
  assert.equal(inbox.body.trades.length, 1);
  const { id, contentHash } = inbox.body.trades[0];
  const ok = await b.call('POST', `/api/trades/${id}/accept`, { contentHash });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.trade.status, 'aceita');
  assert.equal(balances(db, a.user.id).PWC, 0);
  assert.equal(balances(db, b.user.id).PWC, 95, '5% fee');
  assert.equal(db.prepare("SELECT balance FROM wallets WHERE owner = 'system:burn' AND currency = 'PWC'").get().balance, 5);
  assert.equal(qty(a.user.id, 'c-legend'), 1);
  assert.equal(qty(b.user.id, 'c-land'), 14);
  assert.equal((await b.call('POST', `/api/trades/${id}/accept`, { contentHash })).body.error, 'trade_closed');
  assert.deepEqual(checkInvariants(db), []);
});

test('CA-2.4 / 2.5 stale items expire the offer; a different hash is refused', async () => {
  const a = account('player', { veteran: true });
  const b = account('player', { veteran: true });
  const t = (await a.call('POST', '/api/trades', { to: b.user.public_id, offer: { cards: [{ uid: 'c-common', qty: 1 }] }, request: {} })).body.trade;
  assert.equal((await b.call('POST', `/api/trades/${t.id}/accept`, { contentHash: 'x'.repeat(64) })).body.error, 'trade_changed');
  await a.call('POST', '/api/shop/sell', { items: [{ uid: 'c-common', qty: 1, expectedPrice: 10 }] });
  const stale = await b.call('POST', `/api/trades/${t.id}/accept`, { contentHash: t.contentHash });
  assert.equal(stale.body.error, 'trade_stale');
  assert.equal(db.prepare('SELECT status FROM trades WHERE public_id = ?').get(t.id).status, 'expirada');
  assert.equal(qty(b.user.id, 'c-common'), 1, 'nothing moved');
});

test('trade rules: untradeable card, empty offer, daily limit, decline/cancel, flag', async () => {
  const a = account('player', { veteran: true });
  const b = account('player', { veteran: true });
  give(a.user.id, { cards: [{ uid: 'c-player', qty: 1 }] });
  assert.equal((await a.call('POST', '/api/trades', { to: b.user.public_id, offer: { cards: [{ uid: 'c-player', qty: 1 }] }, request: {} })).body.error, 'not_tradeable');
  assert.equal((await a.call('POST', '/api/trades', { to: b.user.public_id, offer: {}, request: {} })).status, 400);
  const t1 = (await a.call('POST', '/api/trades', { to: b.user.public_id, offer: { cards: [{ uid: 'c-land', qty: 1 }] }, request: {} })).body.trade;
  assert.equal((await a.call('POST', `/api/trades/${t1.id}/decline`)).status, 403, 'only the receiver declines');
  assert.equal((await b.call('POST', `/api/trades/${t1.id}/decline`)).body.trade.status, 'recusada');
  const t2 = (await a.call('POST', '/api/trades', { to: b.user.public_id, offer: { cards: [{ uid: 'c-land', qty: 1 }] }, request: {} })).body.trade;
  assert.equal((await a.call('POST', `/api/trades/${t2.id}/cancel`)).body.trade.status, 'cancelada');
  setSetting(db, 'trade.max_per_day', 2);
  assert.equal((await a.call('POST', '/api/trades', { to: b.user.public_id, offer: { cards: [{ uid: 'c-land', qty: 1 }] }, request: {} })).body.error, 'limit_reached');
  setSetting(db, 'trade.max_per_day', 10);
  server.config.features.delete('trades');
  assert.equal((await a.call('POST', '/api/trades', { to: b.user.public_id, offer: { cards: [{ uid: 'c-land', qty: 1 }] }, request: {} })).body.error, 'trades_disabled');
  server.config.features.add('trades');
});

test('RF-2.15 lopsided offer waits for a moderator', async () => {
  const a = account('player', { veteran: true });
  const b = account('player', { veteran: true });
  const mod = account('moderator');
  give(a.user.id, { pwc: 500 });
  const t = (await a.call('POST', '/api/trades', { to: b.user.public_id, offer: { pwc: 500 }, request: {} })).body.trade;
  assert.equal(t.status, 'em_revisao');
  assert.equal((await b.call('GET', '/api/trades?box=in')).body.trades.length, 0);
  assert.equal((await b.call('POST', `/api/trades/${t.id}/accept`, { contentHash: t.contentHash })).body.error, 'trade_closed');
  assert.equal((await a.call('POST', `/api/admin/trades/${t.id}/approve`, { reason: 'eu mesmo' })).status, 403);
  const approved = await mod.call('POST', `/api/admin/trades/${t.id}/approve`, { reason: 'prêmio entre amigos' });
  assert.equal(approved.body.trade.status, 'aberta');
  assert.equal((await b.call('POST', `/api/trades/${t.id}/accept`, { contentHash: t.contentHash })).body.trade.status, 'aceita');
  assert.equal(balances(db, b.user.id).PWC, 475);
});

test('two parallel accepts of one offer: exactly one wins', async () => {
  const a = account('player', { veteran: true });
  const b = account('player', { veteran: true });
  const t = (await a.call('POST', '/api/trades', { to: b.user.public_id, offer: { cards: [{ uid: 'c-land', qty: 3 }] }, request: {} })).body.trade;
  const results = await Promise.all([1, 2, 3].map(() => b.call('POST', `/api/trades/${t.id}/accept`, { contentHash: t.contentHash })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(qty(b.user.id, 'c-land'), 15);
});

test('wishlist and trade matches', async () => {
  const a = account('player', { veteran: true });
  const b = account('player', { veteran: true });
  give(b.user.id, { cards: [{ uid: 'c-pw', qty: 6 }] });
  give(a.user.id, { cards: [{ uid: 'c-common2', qty: 6 }] });
  await a.call('PUT', '/api/me/wishlist', { cards: [{ uid: 'c-pw', qty: 2 }] });
  await b.call('PUT', '/api/me/wishlist', { cards: [{ uid: 'c-common2', qty: 1 }] });
  const m = (await a.call('GET', '/api/trades/matches')).body.matches.find((x) => x.publicId === b.user.public_id);
  assert.deepEqual(m.theyHave, [{ uid: 'c-pw', qty: 2 }]);
  assert.deepEqual(m.theyWant, [{ uid: 'c-common2', qty: 1 }]);
  const spare = await a.call('GET', `/api/players/${b.user.public_id}/spare`);
  assert.deepEqual(spare.body.cards.find((c) => c.uid === 'c-pw'), { uid: 'c-pw', qty: 2 });
  assert.equal((await a.call('PUT', '/api/me/wishlist', { cards: [{ uid: 'ghost', qty: 1 }] })).status, 400);
});

// ----------------------------------------------------------------------- codes

test('RF-2.17 redeem codes: shown once, one use per account, max uses, disable', async () => {
  const admin = account('admin');
  const batch = await admin.call('POST', '/api/admin/codes', { name: 'BSides SP 2026', count: 2, maxUses: 2, reward: { pwc: 50, cards: [{ uid: 'c-pw', qty: 1 }] } });
  assert.equal(batch.status, 200, JSON.stringify(batch.body));
  assert.equal(batch.body.codes.length, 2);
  assert.match(batch.body.codes[0], /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM redeem_codes WHERE code_hash = ?').get(batch.body.codes[0]).n, 0, 'only hashes stored');
  const [code] = batch.body.codes;
  const p1 = account();
  const p2 = account();
  const p3 = account();
  const r = await p1.call('POST', '/api/me/redeem', { code: code.toLowerCase().replace(/-/g, ' ') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.balances.PWC, 50);
  assert.equal(qty(p1.user.id, 'c-pw'), 1);
  assert.equal((await p1.call('POST', '/api/me/redeem', { code })).body.error, 'code_used');
  assert.equal((await p2.call('POST', '/api/me/redeem', { code })).status, 200);
  assert.equal((await p3.call('POST', '/api/me/redeem', { code })).body.error, 'code_invalid', 'max uses reached');
  await admin.call('POST', `/api/admin/codes/${batch.body.id}/disable`, { reason: 'vazou no grupo' });
  assert.equal((await p3.call('POST', '/api/me/redeem', { code: batch.body.codes[1] })).body.error, 'code_invalid');
  const list = (await admin.call('GET', '/api/admin/codes')).body.batches.find((b) => b.id === batch.body.id);
  assert.equal(list.used, 2);
  assert.ok(list.disabledAt);
  assert.equal((await account('player').call('POST', '/api/admin/codes', { name: 'x', count: 1, reward: { cr: 1 } })).status, 403);
});

test('RF-2.18 failed redeem attempts are rate limited', async () => {
  const p = account();
  const statuses = [];
  for (let i = 0; i < 7; i += 1) statuses.push((await p.call('POST', '/api/me/redeem', { code: 'AAAA-BBBB-CCCC' })).status);
  assert.deepEqual(statuses.slice(0, 5), [404, 404, 404, 404, 404]);
  assert.equal(statuses[6], 429);
});

// ----------------------------------------------------------------------- packs

test('packs: flag, adult check, odds, open, refunds and versions', async () => {
  const admin = account('admin');
  const p = account();
  db.prepare("UPDATE card_catalog SET pack_weight = 1 WHERE uid IN ('c-common', 'c-common2', 'c-legend', 'c-pw')").run();
  const slots = [{ count: 3, odds: { comum: 9000, rara: 1000 } }, { count: 1, odds: { mitica: 1, lendaria: 1 } }];
  const created = await admin.call('POST', '/api/admin/packs', { name: 'Booster Hacker', price: 200, slots, active: true });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = created.body.id;
  assert.equal((await p.call('POST', `/api/packs/${id}/open`, { expectedPrice: 200 })).body.error, 'packs_disabled');
  server.config.features.add('packs');
  const list = await (await fetch(`${base}/api/packs`)).json();
  assert.equal(list.products[0].cardsPerPack, 4);
  // No rare card has pack weight: the rare odds are dropped and the common ones become 100%.
  assert.deepEqual(list.products[0].odds[0].rarities, [{ rarity: 'comum', p: 1 }]);
  const odds = await (await fetch(`${base}/api/packs/${id}/odds`)).json();
  const sum = odds.slots[1].cards.reduce((n, c) => n + c.p, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);

  assert.equal((await p.call('POST', `/api/packs/${id}/open`, { expectedPrice: 200 })).body.error, 'adult_required');
  await p.call('PATCH', '/api/me', { adultConfirmed: true });
  assert.equal((await p.call('POST', `/api/packs/${id}/open`, { expectedPrice: 100 })).body.error, 'price_changed');
  db.prepare("UPDATE card_catalog SET max_owned = 0 WHERE uid = 'c-common2'").run();
  const opened = await p.call('POST', `/api/packs/${id}/open`, { expectedPrice: 200 });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.cards.length, 4);
  assert.ok(['mitica', 'lendaria'].includes(opened.body.cards[3].rarity));
  const refunds = opened.body.cards.filter((c) => c.refund > 0);
  assert.ok(refunds.every((c) => c.uid === 'c-common2'));
  assert.equal(opened.body.balances.CR, 500 - 200 + refunds.reduce((n, c) => n + c.refund, 0));
  db.prepare("UPDATE card_catalog SET max_owned = NULL WHERE uid = 'c-common2'").run();

  const updated = await admin.call('PUT', `/api/admin/packs/${id}`, { name: 'Booster Hacker', price: 250, slots, active: true, dailyLimit: 1 });
  assert.equal(updated.status, 200);
  const products = (await admin.call('GET', '/api/admin/packs')).body.products;
  assert.equal(products[0].version, 2);
  assert.equal((await p.call('POST', `/api/packs/${id}/open`, { expectedPrice: 250 })).body.error, 'limit_reached');
  assert.equal((await admin.call('POST', '/api/admin/packs', { name: 'Ruim', price: 1, slots: [{ count: 30, odds: { comum: 1 } }] })).status, 400);
  const history = await p.call('GET', '/api/me/packs/history');
  assert.equal(history.body.openings.length, 1);
  server.config.features.delete('packs');
  assert.deepEqual(checkInvariants(db), []);
});

test('RF-2.27 pity forces a rare when nothing rare came out', () => {
  const pool = { comum: [{ uid: 'a', weight: 1 }], incomum: [], rara: [{ uid: 'r', weight: 1 }], mitica: [], lendaria: [] };
  const slots = [{ count: 3, odds: { comum: 1 } }];
  assert.ok(drawPack(slots, pool).cards.every((c) => c.rarity === 'comum'));
  const forced = drawPack(slots, pool, { forceRare: true });
  assert.equal(forced.pity, true);
  assert.equal(forced.cards[2].rarity, 'rara');
});

// ------------------------------------------------------------ collection rooms

async function socket(token, { protocol = 2, hello = true } = {}) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, token ? { headers: { cookie: `mop_sid=${token}` } } : {});
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const i = waiters.findIndex((w) => w.pred(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const c = {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    next(type) {
      const i = queue.findIndex((m) => m.type === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        waiters.push({ pred: (m) => m.type === type, resolve });
        setTimeout(() => reject(new Error(`timeout waiting ${type}`)), 2000);
      });
    },
  };
  if (!hello) return c;
  c.send({ type: 'hello', name: 'X', protocol });
  c.welcome = await c.next('welcome');
  return c;
}

function landDeck(userId, id = 'd-lands') {
  give(userId, { cards: [{ uid: 'c-land', qty: 10 }] });
  db.prepare('INSERT INTO decks (id, user_id, name, cards, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, 'Só terrenos', JSON.stringify([{ uid: 'c-land', amount: 20 }]), Date.now(), Date.now());
}

test('protocol: v1 guests still welcome; collection rooms need accounts', async () => {
  const v1 = await socket(null, { protocol: 1 });
  assert.equal(v1.welcome.protocol, 1);
  v1.send({ type: 'create', visibility: 'public', mode: 'colecao' });
  assert.equal((await v1.next('error')).code, 'account_required');
  const host = account();
  const h = await socket(host.token);
  h.send({ type: 'create', visibility: 'private', mode: 'colecao' });
  const joined = await h.next('joined');
  assert.equal(joined.room.mode, 'colecao');
  v1.send({ type: 'join', code: joined.room.code });
  assert.equal((await v1.next('error')).code, 'account_required');
  const again = await socket(host.token);
  again.send({ type: 'join', code: joined.room.code });
  assert.equal((await again.next('error')).code, 'same_account');
  for (const s of [v1, h, again]) s.ws.close();
});

test('CA-2.7 / 2.9 / 2.10 collection room: deck validation, canonical lists, consensus rewards', async () => {
  setSetting(db, 'match.min_seconds', 0);
  const A = account();
  const B = account();
  landDeck(A.user.id);
  landDeck(B.user.id);
  db.prepare('INSERT INTO decks (id, user_id, name, cards, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('d-greedy', B.user.id, 'Lendas', JSON.stringify([{ uid: 'c-legend', amount: 4 }, { uid: 'c-land', amount: 20 }]), Date.now(), Date.now());
  const a = await socket(A.token);
  const b = await socket(B.token);
  a.send({ type: 'create', visibility: 'private', mode: 'colecao' });
  const { room } = await a.next('joined');
  b.send({ type: 'join', code: room.code });
  await b.next('joined');

  b.send({ type: 'deck', deckId: 'd-greedy' });
  const bad = await b.next('error');
  assert.equal(bad.code, 'deck_invalid');
  assert.deepEqual(bad.problems.find((p) => p.reason === 'not_owned'), { uid: 'c-legend', name: 'Hacker Lendário', reason: 'not_owned', owned: 0, needed: 4 });

  a.send({ type: 'deck', deckId: 'd-lands' });
  b.send({ type: 'deck', deckId: 'd-lands' });
  const decks = await a.next('decks');
  assert.equal(decks.lists[0].length, 20);
  assert.equal(decks.lists[1].length, 20);

  a.send({ type: 'started' });
  await new Promise((r) => setTimeout(r, 50));
  const before = [balances(db, A.user.id).CR, balances(db, B.user.id).CR];
  a.send({ type: 'result', winnerSeat: 0, turns: 7 });
  b.send({ type: 'result', winnerSeat: 0, turns: 7 });
  const ra = await a.next('match_result');
  const rb = await b.next('match_result');
  assert.equal(ra.status, 'consenso');
  assert.equal(ra.reward, 30, 'participation + win');
  assert.equal(rb.reward, 20);
  assert.equal(balances(db, A.user.id).CR, before[0] + 30);

  // Disagreeing reports pay nothing.
  a.send({ type: 'started' });
  await new Promise((r) => setTimeout(r, 50));
  a.send({ type: 'result', winnerSeat: 0, turns: 7 });
  b.send({ type: 'result', winnerSeat: 1, turns: 7 });
  assert.equal((await a.next('match_result')).status, 'divergente');
  await b.next('match_result');
  // Too short.
  a.send({ type: 'started' });
  await new Promise((r) => setTimeout(r, 50));
  a.send({ type: 'result', winnerSeat: 1, turns: 2 });
  b.send({ type: 'result', winnerSeat: 1, turns: 2 });
  const short = await b.next('match_result');
  await a.next('match_result');
  assert.equal(short.status, 'curta');
  assert.equal(short.reward, 0);
  // Same pair: at most two rewarded matches a day.
  for (let i = 0; i < 2; i += 1) {
    a.send({ type: 'started' });
    await new Promise((r) => setTimeout(r, 50));
    a.send({ type: 'result', winnerSeat: 1, turns: 9 });
    b.send({ type: 'result', winnerSeat: 1, turns: 9 });
    const res = await b.next('match_result');
    await a.next('match_result');
    assert.equal(res.reward > 0, i === 0, `pair match ${i + 2}`);
  }
  a.ws.close();
  b.ws.close();
  setSetting(db, 'match.min_seconds', 120);
  assert.deepEqual(checkInvariants(db), []);
});

// ------------------------------------------------------------ revocation (pentest N-12 / N-20)

const closeCode = (c) => new Promise((resolve) => {
  c.ws.once('close', (code) => resolve(code));
  setTimeout(() => resolve('open'), 1000);
});

test('N-12 logout-all closes the account sockets and frees its seats for good', async () => {
  const A = account();
  const a = await socket(A.token);
  a.send({ type: 'create', visibility: 'private', mode: 'colecao' });
  const joined = await a.next('joined');
  const closed = closeCode(a);
  assert.equal((await A.call('POST', '/api/auth/logout-all')).status, 200);
  assert.equal(await closed, 4001);
  assert.equal(server.rooms.rooms.has(joined.room.code), false);
  const g = await socket(null, { hello: false });
  g.send({ type: 'resume', token: a.welcome.token });
  assert.equal((await g.next('error')).code, 'bad_token');
  g.ws.close();
});

test('N-12 a single logout closes only the sockets of that session', async () => {
  const A = account();
  const second = createSession(db, A.fresh(), { authTime: Date.now() });
  const one = await socket(A.token);
  const two = await socket(second);
  const closed = closeCode(one);
  assert.equal((await A.call('POST', '/api/auth/logout')).status, 200);
  assert.equal(await closed, 4001);
  assert.equal(two.ws.readyState, WebSocket.OPEN);
  two.ws.close();
});

test('N-12 settleMatch pays nobody when a seat belongs to a banned account', () => {
  const A = account();
  const B = account();
  db.prepare("UPDATE users SET status = 'banned' WHERE id = ?").run(B.user.id);
  setSetting(db, 'match.min_seconds', 0);
  const r = settleMatch(db, { code: 'N12X', users: [A.user.id, B.user.id], reports: [{ winnerSeat: 1, turns: 9 }, { winnerSeat: 1, turns: 9 }], startedAt: Date.now() - 1000 });
  assert.equal(r.status, 'consenso');
  assert.deepEqual(r.rewards, []);
});

test('N-20 an account seat is only resumed by the same account; the old socket is closed', async () => {
  const A = account();
  const B = account();
  const a = await socket(A.token);
  const other = await socket(B.token, { hello: false });
  other.send({ type: 'resume', token: a.welcome.token });
  assert.equal((await other.next('error')).code, 'bad_token');
  const guest = await socket(null, { hello: false });
  guest.send({ type: 'resume', token: a.welcome.token });
  assert.equal((await guest.next('error')).code, 'bad_token');
  const again = await socket(A.token, { hello: false });
  const closed = closeCode(a);
  again.send({ type: 'resume', token: a.welcome.token });
  await again.next('resumed');
  assert.equal(await closed, 4000);
  for (const s of [other, guest, again]) s.ws.close();
});

test('N-15 LGPD export: wallet, ledger, collection, trades, matches, sessions with IP and security log', async () => {
  const p = account();
  db.prepare("UPDATE sessions SET ip = '203.0.113.9' WHERE user_id = ?").run(p.user.id);
  const vet = account('player', { veteran: true });
  makeVeteran(p.user.id);
  await p.call('POST', '/api/trades', { to: vet.user.public_id, offer: { cards: [{ uid: 'c-land', qty: 1 }] }, request: {} });
  const r = await p.call('GET', '/api/me/export');
  assert.equal(r.status, 200);
  for (const k of ['account', 'decks', 'wallet', 'ledger', 'collection', 'wishlist', 'trades', 'matches', 'redeemedCodes', 'packs', 'sessions', 'audit']) assert.ok(k in r.body, `falta ${k}`);
  assert.ok(r.body.ledger.length > 0 && r.body.collection.length > 0 && r.body.matches.length > 0);
  assert.equal(r.body.sessions[0].ip, '203.0.113.9');
  assert.equal(r.body.trades[0].otherPlayer, vet.user.public_id);
  assert.deepEqual(Object.keys(r.body.trades[0]).sort(), ['createdAt', 'direction', 'id', 'offer', 'otherPlayer', 'request', 'status']);
});
