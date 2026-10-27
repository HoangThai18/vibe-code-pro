// src/permissions/grants.ts — custom roles, per-module bitmask and data scope, resolved once per request
import type { Pool, PoolClient } from 'pg';
import { withMember } from '../db/tenant';
import { isAction, type Action, type UserActor } from '../shared/authz';
import { HttpError } from '../shared/errors';

export const BIT = { view: 1, create: 2, update: 4, delete: 8, export: 16, approve: 32 } as const;
export type Bit = keyof typeof BIT;
export type Scope = 'own' | 'branch' | 'tenant';

export interface Grants {
  isOwner: boolean;
  permissions: ReadonlySet<Action>;        // custom roles: named permissions
  modules: ReadonlyMap<string, number>;    // bitmask: module → bits
  scope: Scope;
}
export interface PermissionActor extends UserActor, Grants { roleId: string; branchIds: readonly string[] }

export class PermissionDeniedError extends HttpError {
  constructor(what: string) { super(403, 'forbidden', `forbidden: ${what}`); }
}

// One call per check, whichever model the project uses
export function requirePermission(actor: Grants, permission: Action): void {
  if (!actor.isOwner && !actor.permissions.has(permission)) throw new PermissionDeniedError(permission);
}
export function requireBits(actor: Grants, module: string, bit: Bit): void {
  if (!actor.isOwner && ((actor.modules.get(module) ?? 0) & BIT[bit]) === 0) throw new PermissionDeniedError(`${module}:${bit}`);
}

// Under RLS: another tenant's role is not found
export async function loadRoleGrants(db: PoolClient, roleId: string): Promise<Grants | null> {
  const { rows } = await db.query<{ is_owner: boolean; data_scope: Scope; permissions: string[]; modules: Record<string, number> }>(
    `SELECT r.is_owner, r.data_scope,
            ARRAY(SELECT p.permission FROM role_permissions p WHERE p.tenant_id = r.tenant_id AND p.role_id = r.id) AS permissions,
            COALESCE((SELECT jsonb_object_agg(a.module, a.bits) FROM role_module_access a
                       WHERE a.tenant_id = r.tenant_id AND a.role_id = r.id), '{}') AS modules
       FROM roles r WHERE r.tenant_id = app_current_tenant() AND r.id = $1`,
    [roleId],
  );
  const r = rows[0];
  if (!r) return null;
  return { isOwner: r.is_owner, scope: r.data_scope, permissions: new Set(r.permissions.filter(isAction)), modules: new Map(Object.entries(r.modules)) };
}

// Business requests: withMember's membership check, then the member's role, grants and branches, read in the same
// transaction every time (never cached in the token or the process): an edited role applies to the next request
export function withMemberPermissions<T>(
  pool: Pool, tenantId: string, userId: string,
  fn: (db: PoolClient, actor: PermissionActor) => Promise<T>,
): Promise<T> {
  return withMember(pool, tenantId, userId, async (db, member) => {
    const { rows } = await db.query<{ role_id: string; branch_ids: string[] }>(
      `SELECT mr.role_id, ARRAY(SELECT b.branch_id FROM member_branches b
                                 WHERE b.tenant_id = mr.tenant_id AND b.user_id = mr.user_id ORDER BY b.branch_id) AS branch_ids
         FROM member_roles mr WHERE mr.tenant_id = app_current_tenant() AND mr.user_id = $1`,
      [userId],
    );
    const grants = rows[0] && (await loadRoleGrants(db, rows[0].role_id));
    if (!rows[0] || !grants) throw new PermissionDeniedError('no role');
    // For the data_scope policies (section 4)
    await db.query("SELECT set_config('app.data_scope', $1, true), set_config('app.branch_ids', $2, true)",
      [grants.scope, rows[0].branch_ids.join(',')]);
    return fn(db, { ...member, ...grants, roleId: rows[0].role_id, branchIds: rows[0].branch_ids });
  });
}
