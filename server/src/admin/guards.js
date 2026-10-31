import { apiError } from '../errors.js';
import { requireUser } from '../auth/session.js';

export const STAFF = ['moderator', 'admin', 'owner'];
export const ADMINS = ['admin', 'owner'];
export const OWNERS = ['owner'];
export const ROLE_RANK = { player: 0, moderator: 1, admin: 2, owner: 3 };
export const STEP_UP_MS = 15 * 60 * 1000;

/** Role gates for /api/admin/* (ADR-07): checked on every request, whatever the UI shows. */
export function adminGuards(db, config) {
  return {
    staff: requireUser(db, config, { roles: STAFF }),
    admin: requireUser(db, config, { roles: ADMINS }),
    owner: requireUser(db, config, { roles: OWNERS }),
  };
}

/** Sensitive actions need a recent Google login (00-arquitetura S4); the UI then sends the admin to ?step_up=1. */
export async function stepUp(req, reply) {
  if (Date.now() - req.auth.authTime > STEP_UP_MS) return reply.code(401).send(apiError('step_up_required'));
  return undefined;
}

/** An actor may only act on accounts below its own role (the owner may act on anyone but itself). */
export function canActOn(actor, target) {
  if (actor.id === target.id) return false;
  if (actor.role === 'owner') return true;
  return ROLE_RANK[actor.role] > ROLE_RANK[target.role];
}
