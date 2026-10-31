import { transaction } from '../db.js';
import { Kind } from '../../../src/engine/cards.js';
import { MINT, post, userOwner } from './ledger.js';
import { gameDay, getSetting } from './settings.js';

// Same limits as src/stores/decks.js (MIN_PLAY_CARDS, MAX_CARDS, MAX_COPIES; cyberlands unlimited).
export const MIN_PLAY_CARDS = 20;
export const MAX_CARDS = 60;
export const MAX_COPIES = 4;

/**
 * Validates an account deck for a "Coleção" room (RF-2.20): legal (20–60 cards, 4 copies, lands free)
 * and owned (copies <= collection). Returns { deck: {name, list} } or { error, problems }.
 */
export function validateCollectionDeck(db, userId, deckId) {
  const row = typeof deckId === 'string' ? db.prepare('SELECT * FROM decks WHERE user_id = ? AND id = ?').get(userId, deckId) : null;
  if (!row) return { error: 'deck_invalid', problems: [{ reason: 'deck_not_found' }] };
  let cards;
  try {
    cards = JSON.parse(row.cards);
  } catch {
    cards = [];
  }
  const problems = [];
  let total = 0;
  const list = [];
  for (const e of cards) {
    const card = db.prepare('SELECT uid, name, kind, orphan FROM card_catalog WHERE uid = ?').get(e.uid);
    if (!card || card.orphan) {
      problems.push({ uid: e.uid, reason: 'unknown_card' });
      continue;
    }
    total += e.amount;
    if (card.kind !== Kind.LAND && e.amount > MAX_COPIES) problems.push({ uid: e.uid, name: card.name, reason: 'too_many_copies', limit: MAX_COPIES });
    const owned = db.prepare('SELECT quantity FROM user_cards WHERE user_id = ? AND card_uid = ?').get(userId, e.uid)?.quantity || 0;
    if (owned < e.amount) problems.push({ uid: e.uid, name: card.name, reason: 'not_owned', owned, needed: e.amount });
    for (let i = 0; i < e.amount; i += 1) list.push(e.uid);
  }
  if (total < MIN_PLAY_CARDS) problems.push({ reason: 'too_few_cards', count: total, min: MIN_PLAY_CARDS });
  if (total > MAX_CARDS) problems.push({ reason: 'too_many_cards', count: total, max: MAX_CARDS });
  if (problems.length) return { error: 'deck_invalid', problems };
  return { deck: { id: row.id, name: row.name, list } };
}

function bump(db, userId, day, kind, max) {
  const row = db.prepare('SELECT count FROM reward_counters WHERE user_id = ? AND day = ? AND kind = ?').get(userId, day, kind);
  if ((row?.count || 0) >= max) return false;
  db.prepare(`INSERT INTO reward_counters (user_id, day, kind, count) VALUES (?, ?, ?, 1)
              ON CONFLICT (user_id, day, kind) DO UPDATE SET count = count + 1`).run(userId, day, kind);
  return true;
}

/**
 * Settles a finished "Coleção" match from the two reports (RF-2.21): rewards only when both seats
 * agree on the winner, the match lasted match.min_turns turns and match.min_seconds, the daily caps
 * allow it and the same pair has not been rewarded twice today. Returns the stored result.
 */
export function settleMatch(db, { code, users, reports, startedAt }, now = Date.now()) {
  const [r0, r1] = reports;
  const agree = r0.winnerSeat === r1.winnerSeat;
  const turns = Math.min(r0.turns, r1.turns);
  const duration = startedAt ? now - startedAt : 0;
  const long = turns >= getSetting(db, 'match.min_turns') && duration >= getSetting(db, 'match.min_seconds') * 1000;
  const status = !agree ? 'divergente' : long ? 'consenso' : 'curta';
  return transaction(db, () => {
    const day = gameDay(now);
    const dayStart = now - 24 * 3600 * 1000;
    const pairRewarded = db.prepare(`SELECT COUNT(*) AS n FROM match_results WHERE rewarded = 1 AND created_at >= ?
                                     AND ((p0_user = ? AND p1_user = ?) OR (p0_user = ? AND p1_user = ?))`).get(dayStart, users[0], users[1], users[1], users[0]).n;
    const rewards = [];
    if (status === 'consenso' && pairRewarded < 2) {
      const part = getSetting(db, 'economy.match_participation_cr');
      const win = getSetting(db, 'economy.match_win_cr');
      users.forEach((userId, seat) => {
        let amount = 0;
        if (part > 0 && bump(db, userId, day, 'participation', getSetting(db, 'economy.match_participation_max_day'))) amount += part;
        if (win > 0 && r0.winnerSeat === seat && bump(db, userId, day, 'win', getSetting(db, 'economy.match_win_max_day'))) amount += win;
        if (amount > 0) rewards.push({ userId, seat, amount });
      });
    }
    const id = Number(db.prepare(`INSERT INTO match_results (room_code, p0_user, p1_user, winner_seat, turns, duration_ms, status, rewarded, created_at)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(code, users[0], users[1], agree ? r0.winnerSeat : null, turns, duration, status, rewards.length ? 1 : 0, now).lastInsertRowid);
    for (const r of rewards) {
      post(db, {
        kind: 'match_reward', key: `match_reward:${id}:${r.seat}`, actor: r.userId,
        entries: [{ owner: MINT, currency: 'CR', amount: -r.amount }, { owner: userOwner(r.userId), currency: 'CR', amount: r.amount }],
        meta: { match: id, room: code, won: r0.winnerSeat === r.seat },
      });
    }
    return { id, status, rewards: rewards.map(({ seat, amount }) => ({ seat, amount })) };
  });
}
