import fs from 'node:fs';
import path from 'node:path';

const FILE = /^mop-\d{8}-\d{6}\.sqlite$/;

export function backupDir(config) {
  return path.join(config.dataDir, 'backups');
}

/** Consistent copy of the live database (VACUUM INTO), keeping the newest `config.backupKeep` files. */
export function runBackup(db, config, now = new Date()) {
  const dir = backupDir(config);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700); // also a directory left 0755 by an older version
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = path.join(dir, `mop-${stamp}.sqlite`);
  db.prepare('VACUUM INTO ?').run(file);
  fs.chmodSync(file, 0o600);
  const old = listBackups(config).slice(config.backupKeep);
  for (const b of old) fs.rmSync(path.join(dir, b.name), { force: true });
  return file;
}

/** Backups on disk, newest first. */
export function listBackups(config) {
  const dir = backupDir(config);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => FILE.test(n))
    .map((name) => ({ name, ...(({ mtimeMs, size }) => ({ at: mtimeMs, bytes: size }))(fs.statSync(path.join(dir, name))) }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

/**
 * Every BACKUP_HOURS (default 24) while the server runs; the first one shortly after boot when the
 * newest backup is older than the period. Off for in-memory databases (tests) or BACKUP_HOURS=0.
 */
export function startBackups(db, config) {
  if (config.dbFile === ':memory:' || !config.backupHours) return () => {};
  const period = config.backupHours * 3600 * 1000;
  const safe = () => {
    try {
      const file = runBackup(db, config);
      console.log(`[mop-server] backup: ${path.basename(file)}`);
    } catch (err) {
      console.error('[mop-server] backup falhou:', err.message);
    }
  };
  const newest = listBackups(config)[0];
  const first = !newest || Date.now() - newest.at > period ? setTimeout(safe, 60_000) : null;
  const timer = setInterval(safe, period);
  first?.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
