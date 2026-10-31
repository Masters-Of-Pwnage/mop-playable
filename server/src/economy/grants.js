import { MINT, post, userOwner } from './ledger.js';
import { gameDay, getSetting } from './settings.js';

const credit = (userId, amount) => (amount > 0
  ? [{ owner: MINT, currency: 'CR', amount: -amount }, { owner: userOwner(userId), currency: 'CR', amount }]
  : []);

/** Signup grant: starting credits plus the starter collection, once per account (RF-1.7). */
export function grantSignup(db, user, starter) {
  const amount = getSetting(db, 'economy.signup_grant_cr');
  return post(db, {
    kind: 'signup_grant',
    key: `signup_grant:${user.id}`,
    actor: user.id,
    entries: credit(user.id, amount),
    cards: starter.map(({ uid, qty }) => ({ userId: user.id, uid, delta: qty })),
    meta: { credits: amount, cards: starter.length },
  });
}

/** Daily login bonus. The idempotency key is the day itself, so a second claim changes nothing. */
export function claimDaily(db, userId, now = Date.now()) {
  const day = gameDay(now);
  const amount = getSetting(db, 'economy.daily_cr');
  const { replayed } = post(db, { kind: 'daily', key: `daily:${userId}:${day}`, actor: userId, entries: credit(userId, amount), meta: { day } });
  return { claimed: !replayed, amount: replayed ? 0 : amount, day };
}

/** Accounts created before the economy existed get their signup grant once (idempotent). */
export function grantMissingSignups(db, starter) {
  const users = db.prepare(`SELECT * FROM users WHERE status <> 'deleted'
                            AND NOT EXISTS (SELECT 1 FROM ledger_tx WHERE idempotency_key = 'signup_grant:' || users.id)`).all();
  for (const user of users) grantSignup(db, user, starter);
  return users.length;
}
