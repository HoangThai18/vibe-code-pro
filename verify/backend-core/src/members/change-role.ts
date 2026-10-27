// src/members/change-role.ts — inside withMember
import type { PoolClient } from 'pg';
import { audit } from '../audit/audit';
import { authorize, can, ForbiddenError, ROLE_RANK, type Role, type UserActor } from '../shared/authz';
import { HttpError, NotFoundError } from '../shared/errors';

export async function changeMemberRole(db: PoolClient, actor: UserActor, targetUserId: string, newRole: Role) {
  authorize(actor, 'member.role_change');
  // Lock the owners, the actor and the target (one order for every caller) before reading any role:
  // two owners demoting each other at the same moment then run one after the other
  const { rows } = await db.query<{ user_id: string; role: Role }>(
    `SELECT user_id, role FROM memberships
      WHERE tenant_id = app_current_tenant() AND (role = 'owner' OR user_id = ANY($1::uuid[]))
      ORDER BY user_id FOR UPDATE`,
    [[actor.id, targetUserId]],
  );
  const roleOf = (userId: string) => rows.find((r) => r.user_id === userId)?.role;
  const actorRole = roleOf(actor.id);   // re-read under the lock: it may have changed since withMember
  const current = roleOf(targetUserId);
  if (!current) throw new NotFoundError();
  if (!actorRole || !can(actorRole, 'member.role_change')
    || ROLE_RANK[actorRole] < ROLE_RANK[current] || ROLE_RANK[actorRole] < ROLE_RANK[newRole]) {
    throw new ForbiddenError('member.role_change');
  }
  if (current === 'owner' && newRole !== 'owner' && rows.filter((r) => r.role === 'owner').length === 1) {
    throw new HttpError(409, 'last_owner', 'Workspace cần ít nhất một chủ sở hữu.');
  }
  await db.query('UPDATE memberships SET role = $2 WHERE tenant_id = app_current_tenant() AND user_id = $1',
    [targetUserId, newRole]);
  await audit(db, actor, { action: 'member.role_change', entity: 'membership', entityId: targetUserId,
    diff: { before: current, after: newRole } });
}
