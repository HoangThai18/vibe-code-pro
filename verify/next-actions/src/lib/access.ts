// src/lib/access.ts — the first call in every tenant page and Server Action
import { withMember } from '@/db/tenant';            // the vibe-backend skill, references/postgres-rls.md section 4
import { can, type Action, type UserActor } from '@/shared/authz';   // same skill, references/auth.md section 4
import { NotFoundError } from '@/shared/errors';
import { pool } from './db';
import { getSessionUserId } from './session';

export type Denied = { ok: false; code: 'unauthenticated' | 'not_found' | 'forbidden' };
export type Access = { ok: true; actor: UserActor } | Denied;

// Reads the session cookie (request-time data): call it outside 'use cache' functions, never inside
export async function checkAccess(tenantId: unknown, action: Action): Promise<Access> {
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, code: 'unauthenticated' };
  try {
    const actor = await withMember(pool, String(tenantId), userId, async (_db, actor) => actor);
    return can(actor.role, action) ? { ok: true, actor } : { ok: false, code: 'forbidden' };
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, code: 'not_found' };   // not a member, or no such tenant
    throw err;
  }
}
