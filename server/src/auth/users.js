import { randomInt } from 'node:crypto';
import { transaction } from '../db.js';
import { cleanText, MAX_NAME } from '../protocol.js';

// Crockford base32 without I, L, O, U: readable and safe in URLs.
const PUBLIC_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function publicId() {
  let id = '';
  for (let i = 0; i < 10; i += 1) id += PUBLIC_ALPHABET[randomInt(PUBLIC_ALPHABET.length)];
  return id;
}

export function audit(db, { actor = null, action, target = null, before = null, after = null, ip = null }) {
  db.prepare('INSERT INTO audit_log (actor_user_id, action, target, before, after, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(actor, action, target, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), ip, Date.now());
}

/**
 * Finds or creates the account of a verified Google ID token (identified by `sub`, never by e-mail).
 * Verified e-mails listed in OWNER_EMAILS get the owner role. `onSignup(user)` runs inside the same
 * transaction for new accounts (starter grant). Returns { user, created }.
 */
export function upsertGoogleUser(db, claims, config, ip = null, onSignup = null) {
  const verified = claims.email_verified === true && typeof claims.email === 'string';
  const email = verified ? claims.email.toLowerCase() : null;
  const avatar = typeof claims.picture === 'string' && claims.picture.startsWith('https://') ? claims.picture.slice(0, 500) : null;
  const isOwner = email !== null && config.ownerEmails.includes(email);
  const now = Date.now();

  return transaction(db, () => {
    let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(claims.sub);
    let created = false;
    if (!user) {
      const name = cleanText(claims.given_name || claims.name || '', MAX_NAME) || 'Hacker';
      let id = publicId();
      while (db.prepare('SELECT 1 FROM users WHERE public_id = ?').get(id)) id = publicId();
      db.prepare(`INSERT INTO users (public_id, google_sub, email, display_name, avatar_url, role, created_at, last_login_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, claims.sub, email, name, avatar, isOwner ? 'owner' : 'player', now, now);
      user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(claims.sub);
      created = true;
      audit(db, { actor: user.id, action: 'user.signup', target: `user:${user.id}`, after: { role: user.role }, ip });
      if (onSignup) onSignup(user); // same transaction: no account without its starter kit
    } else {
      db.prepare('UPDATE users SET email = COALESCE(?, email), avatar_url = COALESCE(?, avatar_url), last_login_at = ? WHERE id = ?')
        .run(email, avatar, now, user.id);
      if (isOwner && user.role !== 'owner') {
        db.prepare("UPDATE users SET role = 'owner' WHERE id = ?").run(user.id);
        audit(db, { actor: user.id, action: 'user.role.bootstrap', target: `user:${user.id}`, before: { role: user.role }, after: { role: 'owner' }, ip });
      }
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }
    return { user, created };
  });
}

/** Public view of an account (what /api/me returns). */
export function profile(user) {
  return {
    publicId: user.public_id,
    displayName: user.display_name,
    avatarUrl: user.show_avatar ? user.avatar_url : null,
    googleAvatarUrl: user.avatar_url,
    showAvatar: Boolean(user.show_avatar),
    role: user.role,
    adultConfirmed: user.adult_confirmed_at !== null,
    createdAt: user.created_at,
  };
}
