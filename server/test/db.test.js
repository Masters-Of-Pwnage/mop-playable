import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate, openDb, transaction } from '../src/db.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

test('migrations apply once and create the core tables', () => {
  const db = openDb(':memory:');
  const first = migrate(db);
  assert.ok(first.includes('001_core.sql'));
  assert.deepEqual(migrate(db), []);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['users', 'sessions', 'api_tokens', 'settings', 'audit_log', 'schema_migrations']) assert.ok(tables.includes(t), t);
  db.close();
});

test('a failing migration is rolled back and not recorded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mop-mig-'));
  fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE a (x INTEGER);');
  fs.writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE b (x INTEGER); INSERT INTO nope VALUES (1);');
  const db = openDb(':memory:');
  assert.throws(() => migrate(db, dir));
  const names = db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name);
  assert.deepEqual(names, ['001_ok.sql']);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'b'").get().n, 0);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('transaction commits, rolls back on error and nests as savepoints', () => {
  const db = freshDb();
  const put = (key) => db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, '1', Date.now());
  const has = (key) => Boolean(db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key));

  transaction(db, () => put('a'));
  assert.ok(has('a'));

  assert.throws(() => transaction(db, () => {
    put('b');
    throw new Error('boom');
  }), /boom/);
  assert.ok(!has('b'));

  transaction(db, () => {
    put('c');
    assert.throws(() => transaction(db, () => {
      put('d');
      throw new Error('inner');
    }));
    put('e');
  });
  assert.ok(has('c') && has('e'));
  assert.ok(!has('d'));

  // An async function would release the lock at its first await: refused (and rolled back).
  assert.throws(() => transaction(db, async () => put('f')), /synchronous/);
  assert.ok(!has('f'));
  db.close();
});

test('audit log is append-only', () => {
  const db = freshDb();
  db.prepare('INSERT INTO audit_log (action, created_at) VALUES (?, ?)').run('test', Date.now());
  assert.throws(() => db.prepare("UPDATE audit_log SET action = 'x'").run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM audit_log').run(), /append-only/);
  db.close();
});

test('user role and status are constrained', () => {
  const db = freshDb();
  const insert = (role) => db.prepare('INSERT INTO users (public_id, display_name, role, created_at) VALUES (?, ?, ?, ?)')
    .run(`p-${role}`, 'Teste', role, Date.now());
  insert('player');
  assert.throws(() => insert('superuser'), /CHECK/);
  db.close();
});

test('backups: consistent copy, pruned to the newest N', async () => {
  const { runBackup, listBackups } = await import('../src/backup.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mop-bak-'));
  const config = { dataDir: dir, backupKeep: 2, dbFile: path.join(dir, 'mop.sqlite') };
  const db = openDb(config.dbFile);
  migrate(db);
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('x', '1', 1)").run();
  for (const t of ['2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', '2026-10-03T00:00:00Z']) runBackup(db, config, new Date(t));
  const list = listBackups(config);
  assert.deepEqual(list.map((b) => b.name), ['mop-20261003-000000.sqlite', 'mop-20261002-000000.sqlite']);
  const copy = openDb(path.join(dir, 'backups', list[0].name));
  assert.equal(copy.prepare("SELECT value FROM settings WHERE key = 'x'").get().value, '1');
  copy.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('N-14 database and backups are private to the server user (0600 files, 0700 directory)', async () => {
  const { runBackup } = await import('../src/backup.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mop-bak-'));
  const config = { dataDir: dir, backupKeep: 2, dbFile: path.join(dir, 'mop.sqlite') };
  const db = openDb(config.dbFile);
  migrate(db);
  const file = runBackup(db, config, new Date('2026-10-31T00:00:00Z'));
  assert.equal(fs.statSync(config.dbFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o077, 0);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
