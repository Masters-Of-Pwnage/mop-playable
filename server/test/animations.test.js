// Animation upload, review and delivery (docs/sdd/03-animacoes.md §7).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.js';
import { createSession } from '../src/auth/session.js';
import { upsertGoogleUser } from '../src/auth/users.js';
import { createApiToken } from '../src/admin/animations.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
let server;
let base;
let db;
let dataDir;
let seq = 0;

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x40, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(64, 3)]);
const files = (over = {}) => ({ webm: WEBM.toString('base64'), mp4: MP4.toString('base64'), poster: WEBP.toString('base64'), ...over });

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mop-anim-'));
  server = createServer({
    dbFile: ':memory:',
    dataDir,
    staticDir: '/nonexistent',
    cardsFile: path.join(fixtures, 'cards.json'),
    starterDecksFile: path.join(fixtures, 'starter-decks.json'),
    features: new Set(['accounts', 'shop', 'animations']),
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

after(async () => {
  await server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function account(role) {
  seq += 1;
  const { user } = upsertGoogleUser(db, { sub: `anim-${seq}`, given_name: role }, server.config);
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  const token = createSession(db, { ...user, role }, { authTime: Date.now() });
  const csrf = db.prepare('SELECT csrf_token FROM sessions WHERE user_id = ?').get(user.id).csrf_token;
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { cookie: `mop_sid=${token}`, 'X-CSRF-Token': csrf, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { user: { ...user, role }, call };
}

const publicAnimation = async (uid) => (await (await fetch(`${base}/api/catalog`, { cache: 'no-store' })).json()).cards.find((c) => c.uid === uid).animation;

test('upload by admin session, review, public catalog and immutable media', async () => {
  const admin = account('admin');
  const up = await admin.call('POST', '/api/admin/animations/c-legend', { ...files(), provenance: { modelo: 'Seedance 2.0 Fast 480p', custo: 480 } });
  assert.equal(up.status, 200);
  assert.equal(up.body.status, 'revisao');
  assert.equal(await publicAnimation('c-legend'), null, 'not public before approval');

  const queue = (await admin.call('GET', '/api/admin/animations')).body.animations;
  assert.equal(queue[0].uid, 'c-legend');
  assert.deepEqual(queue[0].crop, { x: 8.5, y: 11.5, w: 83, h: 42 });
  assert.equal((await admin.call('POST', `/api/admin/animations/${up.body.id}/approve`)).status, 200);
  const anim = await publicAnimation('c-legend');
  assert.match(anim.webm, /^\/media\/anim\/[a-f0-9]{16}\/[a-f0-9]{16}\.webm$/);

  const media = await fetch(`${base}${anim.webm}`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'video/webm');
  assert.equal(media.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), WEBM);
  assert.equal((await fetch(`${base}/media/anim/../../mop.sqlite`)).status, 404);
  assert.equal((await fetch(`${base}/media/anim/0123456789abcdef/0123456789abcdef.exe`)).status, 404);

  // A second approved clip replaces the first; the flag hides everything.
  const up2 = await admin.call('POST', '/api/admin/animations/c-legend', files({ webm: Buffer.concat([WEBM, Buffer.from('v2')]).toString('base64') }));
  await admin.call('POST', `/api/admin/animations/${up2.body.id}/approve`);
  assert.notEqual((await publicAnimation('c-legend')).webm, anim.webm);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM animations WHERE card_uid = 'c-legend' AND status = 'aprovada'").get().n, 1);
  server.config.features.delete('animations');
  assert.equal(await publicAnimation('c-legend'), null);
  server.config.features.add('animations');
});

test('CA-3.5 / 3.1 wrong format, oversized file, missing consent', async () => {
  const admin = account('admin');
  const fake = await admin.call('POST', '/api/admin/animations/c-legend', files({ mp4: WEBM.toString('base64') }));
  assert.equal(fake.status, 422);
  assert.equal(fake.body.field, 'mp4');
  const big = await admin.call('POST', '/api/admin/animations/c-legend', files({ webm: Buffer.concat([WEBM, Buffer.alloc(1024 * 1024)]).toString('base64') }));
  assert.ok([400, 413, 422].includes(big.status));
  const noConsent = await admin.call('POST', '/api/admin/animations/c-common2', files());
  assert.equal(noConsent.status, 409);
  assert.equal(noConsent.body.error, 'no_consent');
  // Revoking consent hides an approved clip at once.
  db.prepare("UPDATE card_catalog SET animation_consent = 'negado' WHERE uid = 'c-legend'").run();
  assert.equal(await publicAnimation('c-legend'), null);
  db.prepare("UPDATE card_catalog SET animation_consent = 'concedido' WHERE uid = 'c-legend'").run();
});

test('operator token: owner creates it, scope and revocation enforced, moderators cannot upload', async () => {
  const owner = account('owner');
  const admin = account('admin');
  const mod = account('moderator');
  assert.equal((await admin.call('POST', '/api/admin/tokens', { label: 'pipeline' })).status, 403);
  const created = await owner.call('POST', '/api/admin/tokens', { label: 'pipeline', days: 7 });
  assert.match(created.body.token, /^mop_/);
  const viaToken = (token) => fetch(`${base}/api/admin/animations/c-pw`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(files()) });
  assert.equal((await viaToken(created.body.token)).status, 200);
  assert.equal((await viaToken('mop_forjadoforjadoforjadoforjado')).status, 401);
  const wrongScope = createApiToken(db, owner.user.id, { scopes: ['outra:coisa'], label: 'x' });
  assert.equal((await viaToken(wrongScope)).status, 401);
  const list = (await owner.call('GET', '/api/admin/tokens')).body.tokens;
  await owner.call('DELETE', `/api/admin/tokens/${list.find((t) => t.label === 'pipeline').id}`);
  assert.equal((await viaToken(created.body.token)).status, 401);
  assert.equal((await mod.call('POST', '/api/admin/animations/c-pw', files())).status, 403);
  assert.equal((await mod.call('POST', '/api/admin/animations/1/approve')).status, 403);
});
