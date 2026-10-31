// Catalog, ledger, shop and daily bonus (docs/sdd/02-economia.md §8).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.js';
import { createSession } from '../src/auth/session.js';
import { upsertGoogleUser } from '../src/auth/users.js';
import { grantSignup } from '../src/economy/grants.js';
import { balances, checkInvariants, MINT, post, userOwner } from '../src/economy/ledger.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
let server;
let base;
let db;
let starter;
let seq = 0;

before(async () => {
  server = createServer({
    dbFile: ':memory:',
    staticDir: '/nonexistent',
    cardsFile: path.join(fixtures, 'cards.json'),
    starterDecksFile: path.join(fixtures, 'starter-decks.json'),
    features: new Set(['accounts', 'shop']),
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
  starter = [{ uid: 'c-common', qty: 1 }, { uid: 'c-land', qty: 12 }, { uid: 'c-common2', qty: 1 }];
});

after(() => server.close());

/** A signed-up player with a session (skips the OAuth dance, covered by auth.test.js). */
function player(name = 'P') {
  seq += 1;
  const { user } = upsertGoogleUser(db, { sub: `eco-${seq}`, given_name: name }, server.config, null, (u) => grantSignup(db, u, starter));
  const token = createSession(db, user, { authTime: Date.now() });
  const csrf = db.prepare('SELECT csrf_token FROM sessions WHERE user_id = ?').get(user.id).csrf_token;
  const call = async (method, url, body, { key = `k-${seq}-${Math.random().toString(36).slice(2, 12)}` } = {}) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { cookie: `mop_sid=${token}`, 'X-CSRF-Token': csrf, 'Idempotency-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  return { user, call };
}

const fund = (userId, amount) => post(db, {
  kind: 'admin_adjust', key: `fund-${userId}-${Math.random()}`, entries: [{ owner: MINT, currency: 'CR', amount: -amount }, { owner: userOwner(userId), currency: 'CR', amount }],
});

test('catalog seeds rarity, availability and consent from the card list', async () => {
  const res = await fetch(`${base}/api/catalog`);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  const { cards, rarities, shopOpen } = await res.json();
  assert.equal(shopOpen, true);
  assert.deepEqual(rarities.map((r) => r.rarity), ['comum', 'incomum', 'rara', 'mitica', 'lendaria']);
  const by = Object.fromEntries(cards.map((c) => [c.uid, c]));
  assert.equal(by['c-legend'].rarity, 'lendaria');
  assert.equal(by['c-legend'].price, 2500);
  assert.equal(by['c-pw'].rarity, 'mitica');
  assert.equal(by['c-land'].maxOwned, null, 'cyberlands have no copy limit');
  assert.equal(by['c-common'].maxOwned, 4);
  assert.equal(by['c-player'].availability, 'evento');
  assert.equal(by['c-player'].buyable, false);
  assert.equal(by['c-player'].tradeable, false);
  const consent = Object.fromEntries(db.prepare('SELECT uid, animation_consent FROM card_catalog').all().map((r) => [r.uid, r.animation_consent]));
  assert.equal(consent['c-legend'], 'concedido');
  assert.equal(consent['c-player'], 'concedido');
  assert.equal(consent['c-common2'], 'nao_se_aplica');
});

test('signup grant: credits + starter collection, exactly once', async () => {
  const p = player();
  assert.deepEqual(balances(db, p.user.id), { PWC: 0, CR: 500 });
  const again = grantSignup(db, p.user, starter);
  assert.equal(again.replayed, true);
  assert.equal(balances(db, p.user.id).CR, 500);
  const { body } = await p.call('GET', '/api/me/collection');
  assert.deepEqual(Object.fromEntries(body.cards.map((c) => [c.uid, c.qty])), { 'c-common': 1, 'c-land': 12, 'c-common2': 1 });
});

test('buy: debits credits, adds the card, statement shows it', async () => {
  const p = player();
  const r = await p.call('POST', '/api/shop/buy', { items: [{ uid: 'c-common', qty: 2, expectedPrice: 50 }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.balances.CR, 400);
  assert.equal(r.body.cards.find((c) => c.uid === 'c-common').qty, 3);
  const { body } = await p.call('GET', '/api/me/ledger');
  assert.equal(body.entries[0].kind, 'shop_buy');
  assert.equal(body.entries[0].amount, -100);
  assert.deepEqual(body.entries[0].cards, [{ uid: 'c-common', delta: 2 }]);
});

test('CA-2.2 same idempotency key twice charges once', async () => {
  const p = player();
  const items = { items: [{ uid: 'c-common2', qty: 1, expectedPrice: 50 }] };
  const a = await p.call('POST', '/api/shop/buy', items, { key: 'same-key-123' });
  const b = await p.call('POST', '/api/shop/buy', items, { key: 'same-key-123' });
  assert.equal(a.body.replayed, false);
  assert.equal(b.body.replayed, true);
  assert.equal(b.body.balances.CR, 450);
  const missing = await fetch(`${base}/api/shop/buy`, { method: 'POST' });
  assert.equal(missing.status, 401);
});

test('CA-2.3 price changed, funds, copy limit, event card: refused and nothing moves', async () => {
  const p = player();
  const buy = (uid, qty, expectedPrice) => p.call('POST', '/api/shop/buy', { items: [{ uid, qty, expectedPrice }] });
  db.prepare("UPDATE card_catalog SET price_credits = 60 WHERE uid = 'c-common'").run();
  const changed = await buy('c-common', 1, 50);
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error, 'price_changed');
  assert.equal(changed.body.price, 60);
  db.prepare("UPDATE card_catalog SET price_credits = NULL WHERE uid = 'c-common'").run();

  const poor = await buy('c-legend', 1, 2500);
  assert.equal(poor.body.error, 'insufficient_funds');
  assert.equal((await buy('c-common', 4, 50)).body.error, 'max_owned', 'already owns 1, limit 4');
  assert.equal((await buy('c-player', 1, 50)).body.error, 'not_available');
  // A failing item rolls back the whole order (stock and money).
  const soldBefore = db.prepare("SELECT stock_sold FROM card_catalog WHERE uid = 'c-common2'").get().stock_sold;
  db.prepare("UPDATE card_catalog SET stock_total = stock_sold + 10 WHERE uid = 'c-common2'").run();
  const mixed = await p.call('POST', '/api/shop/buy', { items: [{ uid: 'c-common2', qty: 1, expectedPrice: 50 }, { uid: 'c-legend', qty: 1, expectedPrice: 2500 }] });
  assert.equal(mixed.body.error, 'insufficient_funds');
  assert.equal(db.prepare("SELECT stock_sold FROM card_catalog WHERE uid = 'c-common2'").get().stock_sold, soldBefore);
  db.prepare("UPDATE card_catalog SET stock_total = NULL WHERE uid = 'c-common2'").run();
  assert.equal(balances(db, p.user.id).CR, 500);
});

test('CA-4.5 window and stock: not yet, sold out, per-player limit', async () => {
  const p = player();
  fund(p.user.id, 10000);
  const buy = (qty = 1) => p.call('POST', '/api/shop/buy', { items: [{ uid: 'c-pw', qty, expectedPrice: 1000 }] });
  db.prepare("UPDATE card_catalog SET available_from = ? WHERE uid = 'c-pw'").run(Date.now() + 3_600_000);
  assert.equal((await buy()).body.error, 'not_available_yet');
  db.prepare("UPDATE card_catalog SET available_from = NULL, per_user_limit = 1 WHERE uid = 'c-pw'").run();
  assert.equal((await buy()).status, 200);
  assert.equal((await buy()).body.error, 'limit_reached');
  db.prepare("UPDATE card_catalog SET per_user_limit = NULL WHERE uid = 'c-pw'").run();
});

test('CA-2.1 50 parallel buys of the last unit: exactly one succeeds', async () => {
  db.prepare("UPDATE card_catalog SET stock_total = stock_sold + 1 WHERE uid = 'c-legend'").run();
  const players = Array.from({ length: 50 }, () => player());
  for (const p of players) fund(p.user.id, 3000);
  const results = await Promise.all(players.map((p) => p.call('POST', '/api/shop/buy', { items: [{ uid: 'c-legend', qty: 1, expectedPrice: 2500 }] })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.body.error === 'sold_out'));
  const row = db.prepare("SELECT stock_sold, stock_total FROM card_catalog WHERE uid = 'c-legend'").get();
  assert.equal(row.stock_sold, row.stock_total);
  db.prepare("UPDATE card_catalog SET stock_total = NULL WHERE uid = 'c-legend'").run();
});

test('sell back: credits in, card out; event cards and missing copies refused', async () => {
  const p = player();
  const sell = (uid, qty, expectedPrice) => p.call('POST', '/api/shop/sell', { items: [{ uid, qty, expectedPrice }] });
  const ok = await sell('c-land', 2, 10);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.balances.CR, 520);
  assert.equal((await sell('c-common', 2, 10)).body.error, 'insufficient_cards');
  assert.equal((await sell('c-player', 1, 10)).body.error, 'not_sellable');
});

test('daily bonus once per day', async () => {
  const p = player();
  const first = await p.call('POST', '/api/me/daily');
  const second = await p.call('POST', '/api/me/daily');
  assert.equal(first.body.claimed, true);
  assert.equal(first.body.balances.CR, 550);
  assert.equal(second.body.claimed, false);
  assert.equal(second.body.balances.CR, 550);
});

test('shop closed by feature flag', async () => {
  const p = player();
  server.config.features.delete('shop');
  const r = await p.call('POST', '/api/shop/buy', { items: [{ uid: 'c-common', qty: 1, expectedPrice: 50 }] });
  server.config.features.add('shop');
  assert.equal(r.body.error, 'shop_disabled');
});

test('ledger rows are append-only', () => {
  assert.throws(() => db.prepare('UPDATE ledger_entries SET amount = 1').run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM ledger_tx').run(), /append-only/);
});

test('CA-2.8 property: random operations keep invariants I1–I5', async () => {
  const players = Array.from({ length: 10 }, () => player());
  for (const p of players) fund(p.user.id, 2000);
  const uids = ['c-common', 'c-common2', 'c-legend', 'c-pw', 'c-land'];
  const prices = Object.fromEntries((await (await fetch(`${base}/api/catalog`)).json()).cards.map((c) => [c.uid, c]));
  let rnd = 42;
  const next = (n) => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd % n; };
  const results = [];
  for (let batch = 0; batch < 20; batch += 1) {
    const ops = [];
    for (let i = 0; i < 20; i += 1) {
      const p = players[next(players.length)];
      const uid = uids[next(uids.length)];
      const qty = 1 + next(3);
      ops.push(next(3) === 0
        ? p.call('POST', '/api/shop/sell', { items: [{ uid, qty, expectedPrice: prices[uid].sellPrice }] })
        : p.call('POST', '/api/shop/buy', { items: [{ uid, qty, expectedPrice: prices[uid].price }] }));
    }
    results.push(...(await Promise.all(ops)));
  }
  assert.ok(results.every((r) => r.status === 200 || r.status === 409), JSON.stringify(results.find((r) => r.status !== 200 && r.status !== 409)));
  assert.deepEqual(checkInvariants(db), []);
});
