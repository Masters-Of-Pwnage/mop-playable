/**
 * Restore drill check (pentest N-14): opens a backup read-only and prints what it holds plus the
 * ledger invariants I1–I5. Exit code 1 when the file is unreadable or an invariant is broken.
 *   node src/verify-backup.js /data/backups/mop-20261031-000000.sqlite
 */
import { DatabaseSync } from 'node:sqlite';
import { checkInvariants } from './economy/ledger.js';

const file = process.argv[2];
if (!file) {
  console.error('uso: node src/verify-backup.js <arquivo.sqlite>');
  process.exit(2);
}
try {
  const db = new DatabaseSync(file, { readOnly: true });
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const problems = checkInvariants(db);
  const report = {
    arquivo: file,
    integridade: integrity,
    migracoes: db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r) => r.name).pop(),
    usuarios: count('users'),
    transacoes: count('ledger_tx'),
    cartasEmColecoes: db.prepare('SELECT COALESCE(SUM(quantity), 0) AS n FROM user_cards').get().n,
    problemas: problems,
  };
  db.close();
  console.log(JSON.stringify(report, null, 2));
  process.exit(integrity === 'ok' && !problems.length ? 0 : 1);
} catch (err) {
  console.error(`backup ilegível: ${err.message}`);
  process.exit(1);
}
