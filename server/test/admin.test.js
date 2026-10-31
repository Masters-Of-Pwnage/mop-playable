// Admin API (docs/sdd/04-admin.md §10).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createServer } from '../src/server.js';
import { createSession } from '../src/auth/session.js';
import { upsertGoogleUser } from '../src/auth/users.js';
import { applyFlagOverrides } from '../src/admin/admin.js';
import { grantSignup } from '../src/economy/grants.js';
import { balances } from '../src/economy/ledger.js';

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
});

after(() => server.close());

/** Account with a role; `stale` makes its last Google login older than the step-up window. */
function account(role = 'player', { stale = false, name = role } = {}) {
  seq += 1;
  const { user } = upsertGoogleUser(db, { sub: `adm-${seq}`, given_name: name }, server.config, null, (u) => grantSignup(db, u, starter));
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  const fresh = { ...user, role };
  const token = createSession(db, fresh, { authTime: stale ? Date.now() - 3_600_000 : Date.now() });
  const csrf = db.prepare('SELECT csrf_token FROM sessions WHERE user_id = ?').get(user.id).csrf_token;
  const call = async (method, url, body, extra = {}) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { cookie: `mop_sid=${token}`, 'X-CSRF-Token': csrf, 'Idempotency-Key': `key-${seq}-${Math.random().toString(36).slice(2, 10)}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  };
  return { user: fresh, call };
}

test('CA-4.1 roles: players get 403; moderators read but cannot edit the catalog', async () => {
  const player = account('player');
  const mod = account('moderator');
  assert.equal((await player.call('GET', '/api/admin/catalog')).status, 403);
  assert.equal((await player.call('PATCH', '/api/admin/catalog/c-common', { price: 1 })).status, 403);
  assert.equal((await mod.call('GET', '/api/admin/catalog')).status, 200);
  assert.equal((await mod.call('PATCH', '/api/admin/catalog/c-common', { price: 1 })).status, 403);
  assert.equal((await fetch(`${base}/api/admin/dashboard`)).status, 401);
});

test('CA-4.2 / 4.8 price edit: public catalog follows, old price refused, audit trail, optimistic lock', async () => {
  const admin = account('admin');
  const player = account('player');
  const { body: detail } = await admin.call('GET', '/api/admin/catalog/c-common2');
  const stamp = detail.card.updatedAt;
  const ok = await admin.call('PATCH', '/api/admin/catalog/c-common2', { price: 70, rarity: 'incomum' }, { 'If-Match': String(stamp) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.card.effectivePrice, 70);
  const stale = await admin.call('PATCH', '/api/admin/catalog/c-common2', { price: 80 }, { 'If-Match': String(stamp) });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'edit_conflict');

  const pub = (await (await fetch(`${base}/api/catalog`)).json()).cards.find((c) => c.uid === 'c-common2');
  assert.equal(pub.price, 70);
  assert.equal(pub.rarity, 'incomum');
  const buy = await player.call('POST', '/api/shop/buy', { items: [{ uid: 'c-common2', qty: 1, expectedPrice: 50 }] });
  assert.equal(buy.body.error, 'price_changed');

  const { body: after } = await admin.call('GET', '/api/admin/catalog/c-common2');
  assert.equal(after.history[0].action, 'catalog.update');
  assert.deepEqual(after.history[0].before, { rarity: 'comum', price: null });
  assert.deepEqual(after.history[0].after, { rarity: 'incomum', price: 70 });
});

test('catalog validation: window order, stock below sold, sell above price, unknown field', async () => {
  const admin = account('admin');
  const bad = async (changes) => (await admin.call('PATCH', '/api/admin/catalog/c-common', changes)).body;
  assert.equal((await bad({ availableFrom: 2000, availableUntil: 1000 })).field, 'availableUntil');
  assert.equal((await bad({ sellPrice: 99999 })).field, 'sellPrice');
  assert.equal((await bad({ rarity: 'ultra' })).field, 'rarity');
  assert.equal((await bad({ owner: 1 })).field, 'owner');
  db.prepare("UPDATE card_catalog SET stock_sold = 5 WHERE uid = 'c-pw'").run();
  assert.equal((await admin.call('PATCH', '/api/admin/catalog/c-pw', { stockTotal: 3 })).body.field, 'stockTotal');
  db.prepare("UPDATE card_catalog SET stock_sold = 0 WHERE uid = 'c-pw'").run();
});

test('CA-4.3 bulk edit: dry run writes nothing; apply with % adjustment', async () => {
  const admin = account('admin');
  const uids = ['c-common', 'c-legend'];
  const dry = await admin.call('POST', '/api/admin/catalog/bulk', { uids, pricePct: 10, dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.changed, 2);
  assert.deepEqual(dry.body.preview.find((p) => p.uid === 'c-legend').changes.price, { before: null, after: 2750 });
  assert.equal(db.prepare("SELECT price_credits FROM card_catalog WHERE uid = 'c-legend'").get().price_credits, null);
  const applied = await admin.call('POST', '/api/admin/catalog/bulk', { uids, changes: { availability: 'indisponivel' } });
  assert.equal(applied.body.changed, 2);
  assert.equal(db.prepare("SELECT availability FROM card_catalog WHERE uid = 'c-legend'").get().availability, 'indisponivel');
  await admin.call('POST', '/api/admin/catalog/bulk', { uids, changes: { availability: 'loja' } });
  const invalid = await admin.call('POST', '/api/admin/catalog/bulk', { uids: ['c-common', 'nope'], changes: { rarity: 'rara' } });
  assert.equal(invalid.status, 400);
  assert.equal(db.prepare("SELECT rarity FROM card_catalog WHERE uid = 'c-common'").get().rarity, 'comum', 'nothing applied');
});

test('CA-4.4 CSV: export, dry run import, unknown uid rejects the whole file', async () => {
  const admin = account('admin');
  const exp = await admin.call('GET', '/api/admin/catalog/export.csv');
  assert.match(exp.headers.get('content-type'), /text\/csv/);
  const lines = exp.body.trim().split(/\r\n/);
  assert.equal(lines[0], 'uid,name,rarity,price,sellPrice,availability,availableFrom,availableUntil,stockTotal,perUserLimit,maxOwned,tradeable,animationConsent,packWeight');

  const csv = 'uid,rarity,price\r\nc-pw,lendaria,\r\n"c-common",comum,55\r\n';
  const dry = await admin.call('POST', '/api/admin/catalog/import', { csv, dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.changed, 2);
  assert.equal(db.prepare("SELECT rarity FROM card_catalog WHERE uid = 'c-pw'").get().rarity, 'mitica');
  const bad = await admin.call('POST', '/api/admin/catalog/import', { csv: `${csv}ghost,rara,1\r\n` });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.line, 4);
  assert.equal(db.prepare("SELECT price_credits FROM card_catalog WHERE uid = 'c-common'").get().price_credits, null);
  const real = await admin.call('POST', '/api/admin/catalog/import', { csv });
  assert.equal(real.body.changed, 2);
  assert.equal(db.prepare("SELECT price_credits FROM card_catalog WHERE uid = 'c-common'").get().price_credits, 55);
  await admin.call('PATCH', '/api/admin/catalog/c-common', { price: null });
  await admin.call('PATCH', '/api/admin/catalog/c-pw', { rarity: 'mitica' });
});

test('CA-4.6 / 4.7 balance adjustment: step-up, cap for admins, owner unlimited, statement entry', async () => {
  const target = account('player');
  const staleAdmin = account('admin', { stale: true });
  const admin = account('admin');
  const owner = account('owner');
  const url = `/api/admin/users/${target.user.public_id}/adjust`;
  const r1 = await staleAdmin.call('POST', url, { currency: 'CR', amount: 100, reason: 'prêmio do evento' });
  assert.equal(r1.status, 401);
  assert.equal(r1.body.error, 'step_up_required');
  assert.equal((await admin.call('POST', url, { currency: 'CR', amount: 999999, reason: 'teste de teto' })).status, 403);
  const ok = await admin.call('POST', url, { currency: 'PWC', amount: 100, reason: 'prêmio BSides', cards: [{ uid: 'c-legend', delta: 1 }] });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.balances, { PWC: 100, CR: 500 });
  assert.equal((await owner.call('POST', url, { currency: 'CR', amount: 999999, reason: 'owner sem teto' })).status, 200);
  assert.equal((await admin.call('POST', url, { currency: 'CR', amount: -2000000, reason: 'demais' })).status, 400);
  const neg = await owner.call('POST', url, { currency: 'PWC', amount: -101, reason: 'tira mais do que tem' });
  assert.equal(neg.body.error, 'insufficient_funds');
  assert.equal((await admin.call('POST', `/api/admin/users/${admin.user.public_id}/adjust`, { currency: 'CR', amount: 1, reason: 'para mim' })).status, 403);
});

test('moderation: suspend/ban/unban, rank rules, ban kills sessions', async () => {
  const mod = account('moderator');
  const player = account('player');
  const otherAdmin = account('admin');
  const status = (who, body) => mod.call('POST', `/api/admin/users/${who.user.public_id}/status`, body);
  assert.equal((await status(otherAdmin, { action: 'ban', reason: 'tentativa' })).status, 403, 'cannot act on a higher role');
  assert.equal((await status(player, { action: 'suspend', reason: 'flood' })).status, 400, 'suspension needs an end');
  const sus = await status(player, { action: 'suspend', until: Date.now() + 86_400_000, reason: 'flood no lobby' });
  assert.equal(sus.body.user.status, 'suspended');
  assert.equal((await player.call('GET', '/api/me')).status, 401);
  await status(player, { action: 'unban', reason: 'revisto' });
  const detail = await mod.call('GET', `/api/admin/users/${player.user.public_id}`);
  assert.equal(detail.body.user.status, 'active');
  assert.ok(detail.body.audit.some((a) => a.action === 'user.suspend'));
  assert.match(detail.body.user.email ?? '', /^$|•/);
  assert.equal((await mod.call('POST', `/api/admin/users/${mod.user.public_id}/status`, { action: 'ban', reason: 'eu mesmo' })).status, 403);
});

test('roles: only the owner, with step-up', async () => {
  const owner = account('owner');
  const staleOwner = account('owner', { stale: true });
  const admin = account('admin');
  const player = account('player');
  const url = `/api/admin/users/${player.user.public_id}/role`;
  assert.equal((await admin.call('POST', url, { role: 'moderator', reason: 'ajuda no evento' })).status, 403);
  assert.equal((await staleOwner.call('POST', url, { role: 'moderator', reason: 'ajuda no evento' })).body.error, 'step_up_required');
  const ok = await owner.call('POST', url, { role: 'moderator', reason: 'ajuda no evento' });
  assert.equal(ok.body.user.role, 'moderator');
});

test('reversal: mirror transaction, once; refused when the cards are gone', async () => {
  const admin = account('admin');
  const player = account('player');
  const buy = await player.call('POST', '/api/shop/buy', { items: [{ uid: 'c-common', qty: 1, expectedPrice: 50 }] });
  assert.equal(buy.status, 200);
  const rev = await admin.call('POST', `/api/admin/ledger/${buy.body.tx}/reverse`, { reason: 'compra por engano' });
  assert.equal(rev.status, 200);
  assert.equal(balances(db, player.user.id).CR, 500);
  assert.equal((await admin.call('POST', `/api/admin/ledger/${buy.body.tx}/reverse`, { reason: 'de novo' })).status, 409);
  assert.equal((await admin.call('POST', `/api/admin/ledger/${rev.body.tx}/reverse`, { reason: 'estorno do estorno' })).status, 400);

  const entry = (await (await fetch(`${base}/api/catalog`)).json()).cards.find((c) => c.uid === 'c-common2');
  const buy2 = await player.call('POST', '/api/shop/buy', { items: [{ uid: 'c-common2', qty: 1, expectedPrice: entry.price }] });
  const sold = await player.call('POST', '/api/shop/sell', { items: [{ uid: 'c-common2', qty: 1, expectedPrice: entry.sellPrice }] });
  assert.equal(sold.status, 200);
  const gone = await admin.call('POST', `/api/admin/ledger/${buy2.body.tx}/reverse`, { reason: 'carta já vendida' });
  assert.equal(gone.body.error, 'insufficient_cards');
  const detail = await admin.call('GET', `/api/admin/ledger/${buy.body.tx}`);
  assert.equal(detail.body.tx.reversedBy, rev.body.tx);
});

test('flags: runtime switch, owner-only packs, persisted overrides', async () => {
  const admin = account('admin');
  const owner = account('owner');
  const player = account('player');
  assert.equal((await admin.call('PUT', '/api/admin/flags/shop', { on: false })).status, 200);
  assert.equal((await player.call('POST', '/api/shop/buy', { items: [{ uid: 'c-common', qty: 1, expectedPrice: 50 }] })).body.error, 'shop_disabled');
  await admin.call('PUT', '/api/admin/flags/shop', { on: true });
  assert.equal((await admin.call('PUT', '/api/admin/flags/packs', { on: true })).status, 403);
  assert.equal((await admin.call('PUT', '/api/admin/flags/accounts', { on: false })).status, 400);
  assert.equal((await owner.call('PUT', '/api/admin/flags/packs', { on: true })).status, 200);
  const cfg = { features: new Set(['accounts']) };
  applyFlagOverrides(db, cfg);
  assert.deepEqual([...cfg.features].sort(), ['accounts', 'packs', 'shop']);
  await owner.call('PUT', '/api/admin/flags/packs', { on: false });
});

test('settings: typed values, adjust cap owner-only', async () => {
  const admin = account('admin');
  const owner = account('owner');
  assert.equal((await admin.call('PUT', '/api/admin/settings/economy.daily_cr', { value: 75 })).status, 200);
  assert.equal((await admin.call('PUT', '/api/admin/settings/economy.daily_cr', { value: -1 })).status, 400);
  assert.equal((await admin.call('PUT', '/api/admin/settings/nope', { value: 1 })).status, 404);
  assert.equal((await admin.call('PUT', '/api/admin/settings/admin.adjust_cap', { value: { CR: 1, PWC: 1 } })).status, 403);
  assert.equal((await owner.call('PUT', '/api/admin/settings/admin.adjust_cap', { value: { CR: 5000, PWC: 500 } })).status, 200);
  await admin.call('PUT', '/api/admin/settings/economy.daily_cr', { value: 50 });
});

test('live rooms: list and close', async () => {
  const mod = account('moderator');
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
  await new Promise((r) => ws.once('open', r));
  const messages = [];
  ws.on('message', (m) => messages.push(JSON.parse(m)));
  ws.send(JSON.stringify({ type: 'hello', name: 'Host' }));
  ws.send(JSON.stringify({ type: 'create', visibility: 'private' }));
  await new Promise((r) => setTimeout(r, 100));
  const { body } = await mod.call('GET', '/api/admin/rooms');
  const room = body.rooms.find((r) => r.seats[0]?.name === 'Host');
  assert.ok(room);
  assert.equal((await mod.call('POST', `/api/admin/rooms/${room.code}/close`, { reason: 'conteúdo impróprio' })).status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(messages.some((m) => m.type === 'room_closed' && m.reason === 'admin'));
  ws.close();
});

test('CA-4.9 dashboard and health with invariants', async () => {
  const mod = account('moderator');
  const dash = await mod.call('GET', '/api/admin/dashboard');
  assert.equal(dash.status, 200);
  assert.ok(dash.body.users > 0);
  assert.ok(dash.body.credits.issued >= dash.body.credits.inCirculation);
  const health = await mod.call('GET', '/api/admin/health');
  assert.deepEqual(health.body.invariants, []);
  const audit = await mod.call('GET', '/api/admin/audit?action=catalog');
  assert.ok(audit.body.entries.length > 0);
});

test('N-6 rarity defaults cannot make a card sell above its price; effective sell price is capped', async () => {
  const admin = account('admin');
  const original = db.prepare("SELECT * FROM rarity_defaults WHERE rarity = 'comum'").get();
  const card = db.prepare("SELECT * FROM card_catalog WHERE rarity = 'comum' AND kind != 'land' AND availability = 'loja' AND orphan = 0 LIMIT 1").get();
  const restore = db.prepare('UPDATE card_catalog SET price_credits = ?, sell_credits = ? WHERE uid = ?');
  try {
    assert.equal((await admin.call('PATCH', `/api/admin/catalog/${card.uid}`, { price: 40, sellPrice: null })).status, 200);
    const put = await admin.call('PUT', '/api/admin/rarity-defaults/comum', { price: 50, sellPrice: 50 });
    assert.equal(put.status, 400);
    assert.ok(put.body.uids.includes(card.uid));
    // A state already stored before the fix: the catalog and the shop cap the sell price.
    db.prepare("UPDATE rarity_defaults SET sell_credits = 50 WHERE rarity = 'comum'").run();
    const listed = (await (await fetch(`${base}/api/catalog`, { cache: 'no-store' })).json()).cards.find((c) => c.uid === card.uid);
    assert.ok(listed.sellPrice <= listed.price, JSON.stringify(listed));
    const p = account('player');
    const before = balances(db, p.user.id).CR;
    assert.equal((await p.call('POST', '/api/shop/buy', { items: [{ uid: card.uid, qty: 1, expectedPrice: listed.price }] })).status, 200);
    assert.equal((await p.call('POST', '/api/shop/sell', { items: [{ uid: card.uid, qty: 1, expectedPrice: listed.sellPrice }] })).status, 200);
    assert.ok(balances(db, p.user.id).CR <= before);
  } finally {
    db.prepare("UPDATE rarity_defaults SET price_credits = ?, sell_credits = ? WHERE rarity = 'comum'").run(original.price_credits, original.sell_credits);
    restore.run(card.price_credits, card.sell_credits, card.uid);
  }
});

test('N-2 / N-5 ADMIN_ALLOW_CIDRS gates /api/admin by client address; forwarding headers only from trusted proxies', async () => {
  const start = async (over) => {
    const s = createServer({
      dbFile: ':memory:', staticDir: '/nonexistent', features: new Set(['accounts']),
      publicUrl: 'http://127.0.0.1', googleClientId: 'x', googleClientSecret: 'x', sessionSecret: 'x'.repeat(40),
      trustProxy: 1, adminAllowCidrs: ['203.0.113.0/24', '2001:db8::/32'], ...over,
    });
    const { port } = await s.listen(0, '127.0.0.1');
    return { s, url: `http://127.0.0.1:${port}` };
  };
  const status = (url, xff) => fetch(`${url}/api/admin/health`, { headers: xff ? { 'X-Forwarded-For': xff } : {} }).then((r) => r.status);
  const a = await start({ trustedProxies: ['127.0.0.1/32'] });
  try {
    assert.equal(await status(a.url), 403); // the proxy itself is not on the list
    assert.equal(await status(a.url, '198.51.100.7'), 403);
    assert.equal(await status(a.url, '203.0.113.9'), 401); // allowed address: down to the login check
    assert.equal(await status(a.url, '2001:db8::5'), 401);
    assert.equal((await fetch(`${a.url}//api//admin/health`)).status, 400);
    assert.equal((await fetch(`${a.url}/api/features`)).status, 200); // the rest of the API is untouched
  } finally {
    await a.s.close();
  }
  const b = await start({ trustedProxies: ['10.9.9.9/32'] });
  try {
    assert.equal(await status(b.url, '203.0.113.9'), 403); // header from an unknown peer is ignored
  } finally {
    await b.s.close();
  }
});

test('Cloudflare Access: /api/admin needs a valid Access JWT (issuer, audience, signature)', async () => {
  const keys = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'cf1', alg: 'RS256', use: 'sig' };
  const certs = http.createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keys: [jwk] })));
  await new Promise((r) => certs.listen(0, '127.0.0.1', r));
  const team = 'https://team.example';
  const s = createServer({
    dbFile: ':memory:', staticDir: '/nonexistent', features: new Set(['accounts']),
    publicUrl: 'http://127.0.0.1', googleClientId: 'x', googleClientSecret: 'x', sessionSecret: 'x'.repeat(40),
    cfAccess: { teamDomain: team, aud: 'AUD1', certsUrl: `http://127.0.0.1:${certs.address().port}/certs` },
  });
  const { port } = await s.listen(0, '127.0.0.1');
  const jwt = (claims, key = keys) => new SignJWT({ email: 'dono@example.com', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'cf1' }).setIssuedAt().setExpirationTime('5m').sign(key.privateKey);
  const get = (url, token) => fetch(`http://127.0.0.1:${port}${url}`, { redirect: 'manual', headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} });
  try {
    const none = await get('/api/admin/health');
    assert.equal(none.status, 403);
    assert.equal((await none.json()).error, 'access_required');
    assert.equal((await get('/api/admin/health', await jwt({ iss: team, aud: 'OTHER' }))).status, 403);
    assert.equal((await get('/api/admin/health', await jwt({ iss: 'https://evil.example', aud: 'AUD1' }))).status, 403);
    assert.equal((await get('/api/admin/health', await jwt({ iss: team, aud: 'AUD1' }, other))).status, 403);
    const ok = await jwt({ iss: team, aud: 'AUD1' });
    assert.equal((await get('/api/admin/health', ok)).status, 401); // Access passed: down to the game login
    const entry = await get('/api/admin/access', ok);
    assert.equal(entry.status, 302);
    assert.equal(entry.headers.get('location'), '/#/admin');
    assert.equal((await get('/api/features')).status, 200); // only the admin needs Access
  } finally {
    await s.close();
    certs.close();
  }
});

test('NV-1 percent-encoded or absolute-form targets get the same API gates as the plain path', async () => {
  const s = createServer({
    dbFile: ':memory:', staticDir: '/nonexistent', features: new Set(['accounts']),
    publicUrl: 'http://127.0.0.1', googleClientId: 'x', googleClientSecret: 'x', sessionSecret: 'x'.repeat(40),
    adminAllowCidrs: ['203.0.113.0/24'], apiRateLimitBurst: 3, apiRateLimitPerSecond: 0.001,
  });
  const { port } = await s.listen(0, '127.0.0.1');
  const raw = (target) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: target }, (res) => { res.resume(); resolve(res); });
    req.on('error', reject);
    req.end();
  });
  try {
    const enc = await raw('/%61pi/admin/health');
    assert.equal(enc.statusCode, 403); // was 401: the encoded form skipped ADMIN_ALLOW_CIDRS
    assert.match(enc.headers['content-security-policy'], /default-src 'none'/);
    assert.equal((await raw(`http://127.0.0.1:${port}/api/admin/health`)).statusCode, 400);
    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await raw('/%61pi/features')).statusCode);
    assert.ok(statuses.includes(429), statuses.join()); // the rate limit counts the encoded form too
  } finally {
    await s.close();
  }
});
