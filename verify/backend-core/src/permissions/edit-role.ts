// src/permissions/edit-role.ts — inside withMemberPermissions. Editors hand out only what they hold themselves:
// otherwise editing a role, or assigning one, is a way to give yourself more.
import type { PoolClient } from 'pg';
import { audit } from '../audit/audit';
import type { Action } from '../shared/authz';
import { HttpError, NotFoundError } from '../shared/errors';
import { loadRoleGrants, PermissionDeniedError, requirePermission, type Grants, type PermissionActor, type Scope } from './grants';

const SCOPE_RANK: Record<Scope, number> = { own: 1, branch: 2, tenant: 3 };

// Does `actor` hold everything in `g`: each permission, each bit, a scope at least as wide?
export function within(g: Grants, actor: Grants): boolean {
  if (actor.isOwner) return true;
  if (g.isOwner || SCOPE_RANK[g.scope] > SCOPE_RANK[actor.scope]) return false;
  for (const p of g.permissions) if (!actor.permissions.has(p)) return false;
  for (const [module, bits] of g.modules) if ((bits & ~(actor.modules.get(module) ?? 0)) !== 0) return false;
  return true;
}

// Sign-up, in the createTenant transaction: the owner role and its first member
export async function createOwnerRole(db: PoolClient, ownerId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>("INSERT INTO roles (name, is_owner) VALUES ('Chủ spa', true) RETURNING id");
  await db.query('INSERT INTO member_roles (user_id, role_id) VALUES ($1, $2)', [ownerId, rows[0]!.id]);
  return rows[0]!.id;
}

export async function createRole(db: PoolClient, actor: PermissionActor, name: string): Promise<string> {
  requirePermission(actor, 'member.role_change');
  const { rows } = await db.query<{ id: string }>('INSERT INTO roles (name) VALUES ($1) RETURNING id', [name]);
  return rows[0]!.id;
}

// Replace a role's grants. A project keeps one model: drop the permissions or the modules part.
export async function saveRoleGrants(
  db: PoolClient, actor: PermissionActor, roleId: string,
  next: { permissions: Action[]; modules: Record<string, number>; scope: Scope },
): Promise<void> {
  requirePermission(actor, 'member.role_change');   // bitmask projects: requireBits(actor, 'member', 'update')
  const current = await loadRoleGrants(db, roleId);
  if (!current) throw new NotFoundError();
  if (current.isOwner) throw new HttpError(409, 'owner_role_locked', 'Không sửa được vai trò chủ sở hữu.');
  const wanted: Grants = { isOwner: false, scope: next.scope, permissions: new Set(next.permissions), modules: new Map(Object.entries(next.modules)) };
  // What the role has now and what it will have must both be within the editor's grants
  if (!within(current, actor) || !within(wanted, actor)) throw new PermissionDeniedError('member.role_change');
  await db.query('UPDATE roles SET data_scope = $2 WHERE tenant_id = app_current_tenant() AND id = $1', [roleId, next.scope]);
  await db.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
  await db.query('INSERT INTO role_permissions (role_id, permission) SELECT $1, unnest($2::text[])', [roleId, next.permissions]);
  await db.query('DELETE FROM role_module_access WHERE role_id = $1', [roleId]);
  await db.query('INSERT INTO role_module_access (role_id, module, bits) SELECT $1, key, value::int FROM jsonb_each_text($2)',
    [roleId, next.modules]);
  await audit(db, actor, { action: 'member.role_change', entity: 'role', entityId: roleId,
    diff: { before: { ...current, permissions: [...current.permissions], modules: Object.fromEntries(current.modules) }, after: next } });
}

// Give a member a role: the editor must hold both the new role and the member's current one,
// only owners hand out the owner role, and the last owner keeps it
export async function assignRole(db: PoolClient, actor: PermissionActor, userId: string, roleId: string): Promise<void> {
  requirePermission(actor, 'member.role_change');
  // Lock the owners' assignments first, in one order, as in auth.md section 5
  const { rows: owners } = await db.query<{ user_id: string }>(
    `SELECT mr.user_id FROM member_roles mr JOIN roles r ON r.tenant_id = mr.tenant_id AND r.id = mr.role_id
      WHERE mr.tenant_id = app_current_tenant() AND r.is_owner ORDER BY mr.user_id FOR UPDATE OF mr`);
  const target = await loadRoleGrants(db, roleId);
  if (!target) throw new NotFoundError();
  const { rows } = await db.query<{ role_id: string }>(
    'SELECT role_id FROM member_roles WHERE tenant_id = app_current_tenant() AND user_id = $1 FOR UPDATE', [userId]);
  const current = rows[0] ? await loadRoleGrants(db, rows[0].role_id) : null;
  if (!within(target, actor) || (current && !within(current, actor))) throw new PermissionDeniedError('member.role_change');
  if (current?.isOwner && !target.isOwner && owners.length <= 1) {
    throw new HttpError(409, 'last_owner', 'Workspace cần ít nhất một chủ sở hữu.');
  }
  await db.query(
    `INSERT INTO member_roles (user_id, role_id) VALUES ($1, $2)
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id`, [userId, roleId]);
  await audit(db, actor, { action: 'member.role_change', entity: 'membership', entityId: userId, diff: { role: roleId } });
}
