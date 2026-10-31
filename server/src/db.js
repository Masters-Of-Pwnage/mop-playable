import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

/** Opens (or creates) the SQLite database. ":memory:" is used by the tests. */
export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  return db;
}

const depth = new WeakMap();

/**
 * Runs `fn` inside a write transaction. The outermost call takes the write lock up front
 * (BEGIN IMMEDIATE), so every balance check made inside `fn` sees the state it will write on:
 * one writer at a time, no double spend. Nested calls become savepoints.
 * `fn` must be synchronous: an await inside it would let other requests interleave.
 */
export function transaction(db, fn) {
  const level = depth.get(db) || 0;
  const savepoint = `sp${level}`;
  db.exec(level === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
  depth.set(db, level + 1);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') throw new Error('transaction() needs a synchronous function');
    db.exec(level === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
    return result;
  } catch (err) {
    db.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    throw err;
  } finally {
    depth.set(db, level);
  }
}

/** Applies server/migrations/NNN_name.sql files not applied yet, each in its own transaction. */
export function migrate(db, dir = MIGRATIONS_DIR) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    transaction(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, Date.now());
    });
    applied.push(file);
  }
  return applied;
}
