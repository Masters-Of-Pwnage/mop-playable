/** Economy settings (docs/sdd/04-admin.md §5): JSON values in the settings table, with these defaults. */
export const DEFAULTS = {
  'economy.signup_grant_cr': 500,
  'economy.daily_cr': 50,
  'economy.pwc_to_cr': 10,
  'economy.convert_max_per_day': 1000,
  'economy.match_participation_cr': 20,
  'economy.match_participation_max_day': 5,
  'economy.match_win_cr': 10,
  'economy.match_win_max_day': 3,
  'trade.fee_pct': 5,
  'trade.max_per_day': 10,
  'trade.max_imbalance_cr': 2000,
  'trade.new_account_days': 7,
  'trade.new_account_matches': 10,
  'admin.adjust_cap': { CR: 5000, PWC: 500 },
};

export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return DEFAULTS[key];
  try {
    return JSON.parse(row.value);
  } catch {
    return DEFAULTS[key];
  }
}

export function setSetting(db, key, value, userId = null) {
  db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
              ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .run(key, JSON.stringify(value), Date.now(), userId);
}

/** Calendar day of the players (daily rewards reset at midnight in Brazil). */
export function gameDay(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
}
