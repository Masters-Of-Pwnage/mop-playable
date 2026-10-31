// Google login against a local fake OpenID provider (docs/sdd/01-login-google.md §8).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createServer } from '../src/server.js';

const CLIENT_ID = 'mop-test-client';
let idp;
let idpUrl;
let keys;
let otherKeys;
let server;
let base;
// What the fake provider puts in the next ID token (each test sets it).
let nextClaims = {};
let signWith = null;
let lastTokenRequest = null;

before(async () => {
  keys = await generateKeyPair('RS256');
  otherKeys = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  idp = http.createServer(async (req, res) => {
    if (req.url === '/jwks') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (req.url === '/token' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      lastTokenRequest = Object.fromEntries(new URLSearchParams(body));
      const claims = { iss: idpUrl, aud: CLIENT_ID, sub: 'g-123', email: 'player@example.com', email_verified: true, given_name: 'Ana', ...nextClaims };
      const idToken = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuedAt()
        .setExpirationTime(claims.exp ?? '5m')
        .sign((signWith || keys).privateKey);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id_token: idToken, access_token: 'unused' }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => idp.listen(0, '127.0.0.1', r));
  idpUrl = `http://127.0.0.1:${idp.address().port}`;

  server = createServer({
    dbFile: ':memory:',
    staticDir: '/nonexistent',
    features: new Set(['accounts']),
    publicUrl: 'http://127.0.0.1:1', // replaced below once the port is known
    googleClientId: CLIENT_ID,
    googleClientSecret: 'secret',
    sessionSecret: 'x'.repeat(40),
    ownerEmails: ['owner@example.com'],
    oidc: { authUrl: `${idpUrl}/auth`, tokenUrl: `${idpUrl}/token`, jwksUrl: `${idpUrl}/jwks`, issuers: [idpUrl] },
    apiRateLimitBurst: 1000,
  });
  const addr = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${addr.port}`;
  server.config.publicUrl = base;
});

after(async () => {
  await server.close();
  await new Promise((r) => idp.close(r));
});

/** Cookie jar of one browser. */
function browser() {
  const jar = new Map();
  const store = (res) => {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a) || /expires=thu, 01 jan 1970/i.test(a));
      if (expired || value === '') jar.delete(name);
      else jar.set(name, value);
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    jar,
    cookie,
    async fetch(path, opts = {}) {
      const res = await fetch(path.startsWith('http') ? path : `${base}${path}`, {
        redirect: 'manual',
        ...opts,
        headers: { ...(opts.headers || {}), cookie: cookie() },
      });
      store(res);
      return res;
    },
  };
}

/** Full login: start -> (fake Google consent) -> callback. Returns the final redirect target. */
async function login(b, { returnTo = '#/decks', claims = {}, tamper = null } = {}) {
  nextClaims = claims;
  const start = await b.fetch(`/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`);
  assert.equal(start.status, 302);
  const auth = new URL(start.headers.get('location'));
  const params = Object.fromEntries(auth.searchParams);
  let state = params.state;
  if (tamper === 'state') state = 'forged';
  if (tamper === 'nonce') nextClaims = { ...nextClaims, nonce: 'other' };
  else nextClaims = { nonce: params.nonce, ...nextClaims };
  const cb = await b.fetch(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`);
  assert.equal(cb.status, 302);
  return { location: cb.headers.get('location'), params };
}

async function me(b) {
  const res = await b.fetch('/api/me');
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

test('CA-1.1 login returns to the page, creates the account and the session', async () => {
  const b = browser();
  const { location, params } = await login(b);
  assert.equal(location, '/#/decks');
  assert.equal(params.code_challenge_method, 'S256');
  assert.equal(params.redirect_uri, `${base}/api/auth/google/callback`);
  assert.ok(lastTokenRequest.code_verifier, 'PKCE verifier sent to the token endpoint');
  const { status, body } = await me(b);
  assert.equal(status, 200);
  assert.equal(body.displayName, 'Ana');
  assert.equal(body.role, 'player');
  assert.ok(body.csrfToken);
  assert.ok(!('email' in body), 'e-mail is not exposed by /api/me');
  assert.ok(!b.jar.has('mop_oauth'), 'state cookie is cleared');
});

test('CA-1.2 / 1.3 forged state, wrong nonce, wrong audience or foreign key: no session', async () => {
  for (const [tamper, claims, key] of [['state', {}, null], ['nonce', {}, null], [null, { aud: 'other-client' }, null], [null, {}, 'other']]) {
    const b = browser();
    signWith = key === 'other' ? otherKeys : null;
    const { location } = await login(b, { tamper, claims: { sub: 'g-evil', ...claims } });
    signWith = null;
    assert.equal(location, '/#/?login=erro', `${tamper || JSON.stringify(claims) || key}`);
    assert.equal((await me(b)).status, 401);
  }
});

test('CA-1.4 return_to outside the app falls back to the home route', async () => {
  for (const evil of ['https://evil.example', '//evil.example', '#//evil.example', '/#/x']) {
    const { location } = await login(browser(), { returnTo: evil });
    assert.equal(location, '/#/');
  }
});

test('CA-1.5 same Google account twice: one user, owner bootstrap by verified e-mail', async () => {
  await login(browser(), { claims: { sub: 'g-twice' } });
  await login(browser(), { claims: { sub: 'g-twice' } });
  assert.equal(server.db.prepare("SELECT count(*) AS n FROM users WHERE google_sub = 'g-twice'").get().n, 1);
  const owner = browser();
  await login(owner, { claims: { sub: 'g-owner', email: 'OWNER@example.com' } });
  assert.equal((await me(owner)).body.role, 'owner');
  const unverified = browser();
  await login(unverified, { claims: { sub: 'g-unverified', email: 'owner@example.com', email_verified: false } });
  assert.equal((await me(unverified)).body.role, 'player');
});

test('CA-1.6 mutations need the CSRF token and an allowed Origin', async () => {
  const b = browser();
  await login(b, { claims: { sub: 'g-csrf' } });
  const { csrfToken } = (await me(b)).body;
  const patch = (headers) => b.fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ displayName: 'Nova' }) });
  assert.equal((await patch({})).status, 403);
  assert.equal((await patch({ 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await patch({ 'X-CSRF-Token': csrfToken, Origin: 'https://evil.example' })).status, 403);
  const ok = await patch({ 'X-CSRF-Token': csrfToken, Origin: base });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).displayName, 'Nova');
});

test('CA-1.7 banned account cannot log in; banning kills existing sessions', async () => {
  const b = browser();
  await login(b, { claims: { sub: 'g-ban' } });
  assert.equal((await me(b)).status, 200);
  server.db.prepare("UPDATE users SET status = 'banned' WHERE google_sub = 'g-ban'").run();
  assert.equal((await me(b)).status, 401);
  const { location } = await login(browser(), { claims: { sub: 'g-ban' } });
  assert.equal(location, '/#/?login=suspensa');
});

test('logout revokes the session; a new login replaces the old session id', async () => {
  const b = browser();
  await login(b, { claims: { sub: 'g-out' } });
  const first = b.jar.get('mop_sid');
  await login(b, { claims: { sub: 'g-out' } });
  assert.notEqual(b.jar.get('mop_sid'), first);
  const stale = browser();
  stale.jar.set('mop_sid', first);
  assert.equal((await me(stale)).status, 401);
  const { csrfToken } = (await me(b)).body;
  assert.equal((await b.fetch('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } })).status, 200);
  assert.equal((await me(b)).status, 401);
});

test('account decks: save, list, validate, import, isolation', async () => {
  const a = browser();
  await login(a, { claims: { sub: 'g-decks-a' } });
  const { csrfToken } = (await me(a)).body;
  const json = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken };
  const deck = { name: 'Aggro', cards: [{ uid: 'c1', amount: 4 }, { uid: 'c2', amount: 2 }, { uid: 'c1', amount: 1 }] };
  const put = await a.fetch('/api/me/decks/d-1', { method: 'PUT', headers: json, body: JSON.stringify(deck) });
  assert.equal(put.status, 200);
  assert.deepEqual((await put.json()).cards, [{ uid: 'c1', amount: 5 }, { uid: 'c2', amount: 2 }]);
  const bad = await a.fetch('/api/me/decks/d-2', { method: 'PUT', headers: json, body: JSON.stringify({ name: 'X', cards: [{ uid: 'c1', amount: 61 }] }) });
  assert.equal(bad.status, 400);
  const imp = await a.fetch('/api/me/decks/import', { method: 'POST', headers: json, body: JSON.stringify({ decks: [{ id: 'local-1', ...deck }, { id: 'd-1', ...deck }, { id: '../x', ...deck }] }) });
  assert.deepEqual(await imp.json(), { imported: 1, skipped: 2 });
  const list = (await (await a.fetch('/api/me/decks')).json()).decks;
  assert.deepEqual(list.map((d) => d.id).sort(), ['d-1', 'local-1']);

  const other = browser();
  await login(other, { claims: { sub: 'g-decks-b' } });
  assert.deepEqual((await (await other.fetch('/api/me/decks')).json()).decks, []);
  const otherCsrf = (await me(other)).body.csrfToken;
  await other.fetch('/api/me/decks/d-1', { method: 'DELETE', headers: { 'X-CSRF-Token': otherCsrf } });
  assert.equal((await (await a.fetch('/api/me/decks')).json()).decks.length, 2, 'cannot delete another account deck');
});

test('CA-1.9 account deletion removes personal data and keeps the row', async () => {
  const b = browser();
  await login(b, { claims: { sub: 'g-del', given_name: 'Bia' } });
  const { csrfToken } = (await me(b)).body;
  const json = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken };
  assert.equal((await b.fetch('/api/me', { method: 'DELETE', headers: json, body: JSON.stringify({ confirm: 'errado' }) })).status, 400);
  assert.equal((await b.fetch('/api/me', { method: 'DELETE', headers: json, body: JSON.stringify({ confirm: 'Bia' }) })).status, 200);
  assert.equal((await me(b)).status, 401);
  const row = server.db.prepare("SELECT * FROM users WHERE display_name = 'Jogador removido' AND status = 'deleted'").get();
  assert.ok(row);
  assert.equal(row.google_sub, null);
  assert.equal(row.email, null);
  // Logging in again with the same Google account starts a fresh account.
  await login(browser(), { claims: { sub: 'g-del' } });
  assert.equal(server.db.prepare("SELECT count(*) AS n FROM users WHERE google_sub = 'g-del'").get().n, 1);
});

test('lobby: logged-in socket uses the account name and cannot rename', async () => {
  const b = browser();
  await login(b, { claims: { sub: 'g-ws', given_name: 'Carla' } });
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { cookie: b.cookie() } });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const next = () => new Promise((r) => ws.once('message', (m) => r(JSON.parse(m))));
  ws.send(JSON.stringify({ type: 'hello', name: 'Impostor' }));
  const welcome = await next();
  assert.equal(welcome.account.displayName, 'Carla');
  ws.send(JSON.stringify({ type: 'create', visibility: 'public', name: 'Mesa' }));
  const joined = await next();
  assert.equal(joined.room.players[0].name, 'Carla');
  ws.close();
});

test('accounts cannot start half configured', () => {
  assert.throws(() => createServer({ dbFile: ':memory:', features: new Set(['accounts']), publicUrl: '', googleClientId: '', googleClientSecret: '', sessionSecret: '' }), /PUBLIC_URL.*GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET.*SESSION_SECRET/);
});
