# Permissions: choosing an authorization model

Who defines the roles, and how fine the rules must be, decide the model. Fixed roles in code (`references/auth.md` section 4) are the default; this file covers the others, data scope (own / branch / whole tenant), and how to choose with the user.

Ran on PostgreSQL 16 (FORCE RLS, composite FKs, app role without BYPASSRLS) and Node 22: a tenant can't see or assign another tenant's roles; nobody grants a permission, bit or scope they don't hold; the owner role can't be changed and a tenant keeps an owner, also when two owners demote each other at once; a role edit applies to the next request; branch-scoped staff see only their branch. Removing each of these safeguards failed a test.

## Contents
1. Models
2. Choosing with the user
3. Custom roles and the bitmask
4. Data scope: own, branch, tenant
5. Tests

## 1. Models

| Model | Fits | Costs |
|---|---|---|
| **Fixed roles in code** (`references/auth.md` section 4) | MVP; 2–4 roles every spa shares (owner, manager, staff) | A spa can't define its own role; a new role is a code change and a deploy |
| **Per-tenant custom roles** | Owners create roles ("Lễ tân ca tối") and tick permissions per role | Role editor UI, escalation rules, owner protection, more tests (section 3) |
| **Per-module bitmask** ("ma trận phân quyền", as in Vietnamese ERP/CRM apps) | Users expect the matrix screen: modules × view=1, create=2, update=4, delete=8, export=16, approve=32 | See below |
| **Data scope**, a second axis on any model | Chains with branches; technicians who see only their own appointments | Enforced in RLS and set on every request and job (section 4) |
| **Policy engine** | Sharing single records with chosen people or teams, deep hierarchies, several services asking the same question | Another service to run and keep in sync with your data, a call per check, a policy language to learn |

The bitmask, honestly:

- **For**: compact (one integer per role and module), maps one-to-one onto the matrix screen, checked with one `&`.
- **Against**: bit meanings are fixed forever (renumbering corrupts every stored mask); a new verb means a migration (CHECK, readable view) and a code change; unreadable in SQL without a view; some verbs make no sense on some modules (approve a customer?); alone it can't say "own records" or "this branch": add data scope.
- Named permissions cost a row per grant, but read clearly, and a new one is a catalog row. Prefer them unless the product wants the matrix; you can still draw named permissions as a matrix.

Policy engines (check their current docs before adopting one):

| Engine | What it is |
|---|---|
| OpenFGA | Open-source relationship-based engine modeled on Google Zanzibar; started at Auth0/Okta, now a CNCF incubating project |
| SpiceDB | AuthZed's open-source Zanzibar-style permissions database |
| Cerbos | Open-source stateless policy decision point; policies in YAML (roles and attributes), no database of its own |
| Oso | Oso Cloud, a hosted service with the Polar policy language; its open-source library is deprecated |

Worth it for Google Drive-style sharing ("share this customer file with that technician"), relationship chains (chain → region → branch → room), or permissions shared by many services. Not for roles × modules × branches in one spa SaaS: PostgreSQL and RLS do that with no extra service, and the tenant check stays in the database.

## 2. Choosing with the user

The model is a product decision. Before building:

1. Read the project docs (PRD, `ARCHITECTURE.md`, ADRs). If they settle it, follow them.
2. If not, present 2–3 options that fit, each with its main trade-off, recommend one and say why, and ask before building.
3. Record the choice as an ADR (the `vibe-plan` skill).

| Signal in the PRD or the conversation | Lean towards |
|---|---|
| No mention, or "owner, manager, staff", MVP | Fixed roles |
| "spa tự tạo vai trò", permissions per staff member | Custom roles |
| A matrix screenshot, users coming from an ERP | Bitmask, or custom roles drawn as a matrix |
| "chi nhánh", "chỉ xem khách của mình" | Add data scope |
| Sharing single records outside the roles | A policy engine |

Starting with fixed roles is cheap to undo early: moving to custom roles is a data migration (one role per old role in each tenant, then assign members).

## 3. Custom roles and the bitmask

Both use `roles` and `member_roles` (one role per member). A project keeps one grant table: `role_permissions` (named) or `role_module_access` (bits); the code below handles both so they can be compared.

```sql
-- Roles each tenant defines, e.g. 'Lễ tân ca tối'. One role per member.
CREATE TABLE roles (
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  is_owner   boolean NOT NULL DEFAULT false,      -- holds every permission; never edited or deleted
  data_scope text NOT NULL DEFAULT 'tenant' CHECK (data_scope IN ('own', 'branch', 'tenant')),   -- section 4
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, name)
);
CREATE UNIQUE INDEX roles_one_owner ON roles (tenant_id) WHERE is_owner;

CREATE TABLE member_roles (
  tenant_id uuid NOT NULL DEFAULT app_current_tenant(),
  user_id   uuid NOT NULL,
  role_id   uuid NOT NULL,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships (tenant_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles (tenant_id, id)   -- composite: only this tenant's roles
);
CREATE INDEX member_roles_role ON member_roles (tenant_id, role_id);

-- The DB backs up the code: the owner role stays as created
CREATE FUNCTION protect_owner_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the owner role cannot be changed or deleted';
END $$;
CREATE TRIGGER roles_owner_locked BEFORE UPDATE OR DELETE ON roles
  FOR EACH ROW WHEN (OLD.is_owner) EXECUTE FUNCTION protect_owner_role();

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON roles
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
ALTER TABLE member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_roles
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
```

```sql
-- Custom roles: named permissions per role, from a global read-only catalog (the Actions in shared/authz.ts)
CREATE TABLE permissions (key text PRIMARY KEY);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON permissions FROM app_user;
INSERT INTO permissions (key) VALUES
  ('customer.read'), ('customer.write'), ('customer.import'), ('appointment.write'), ('appointment.confirm'),
  ('billing.manage'), ('member.invite'), ('member.role_change'), ('api_key.manage');

CREATE TABLE role_permissions (
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant(),
  role_id    uuid NOT NULL,
  permission text NOT NULL REFERENCES permissions (key),
  PRIMARY KEY (tenant_id, role_id, permission),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles (tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_permissions
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
```

```sql
-- Bitmask per module ("ma trận phân quyền"): view=1, create=2, update=4, delete=8, export=16, approve=32
CREATE TABLE modules (key text PRIMARY KEY);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON modules FROM app_user;
INSERT INTO modules (key) VALUES ('customer'), ('appointment'), ('invoice'), ('report'), ('member');

CREATE TABLE role_module_access (
  tenant_id uuid NOT NULL DEFAULT app_current_tenant(),
  role_id   uuid NOT NULL,
  module    text NOT NULL REFERENCES modules (key),
  bits      integer NOT NULL CHECK (bits BETWEEN 0 AND 63),   -- a 7th bit: this CHECK, the view and BIT change
  PRIMARY KEY (tenant_id, role_id, module),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles (tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE role_module_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_module_access FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_module_access
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));

-- Bits are unreadable in SQL: support and reports read this view
CREATE VIEW role_access_matrix WITH (security_invoker = true) AS
SELECT tenant_id, role_id, module,
       (bits & 1) <> 0 AS can_view, (bits & 2) <> 0 AS can_create, (bits & 4) <> 0 AS can_update,
       (bits & 8) <> 0 AS can_delete, (bits & 16) <> 0 AS can_export, (bits & 32) <> 0 AS can_approve
  FROM role_module_access;
```

```ts
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
```

```ts
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
```

- **Resolve once per request**, in the request's transaction: `withMemberPermissions` wraps `withMember` (`references/postgres-rls.md` section 4; the membership check and its 404 stay), and every check is one call: `requirePermission(actor, 'customer.write')` or `requireBits(actor, 'customer', 'update')`. Don't call `authorize` there: it reads `memberships.role`, which this model keeps only as a label.
- **No stale grants**: never put permissions in the access token or a process cache. If you must cache, key it by a version that every role edit bumps.
- **No escalation**: editing or assigning a role requires holding everything the role has and gets: permissions, bits and scope (`within`). Only owners hand out the owner role.
- **The owner role** is created at sign-up and means every permission; the code returns 409 on any edit and a trigger refuses changes in SQL. A tenant keeps an owner: lock the owner assignments `FOR UPDATE` before counting, as in `references/auth.md` section 5. Removing a member (the membership delete cascades to `member_roles`) needs the same check.
- **Tenant isolation**: RLS on every role table, and composite FKs `(tenant_id, role_id)`, so another tenant's role is neither visible nor assignable.
- **Catalogs** (`permissions`, `modules`) are global and read-only for the app role; a migration adds entries. A test checks that `permissions` matches the `Action` list.

## 4. Data scope: own, branch, tenant

```sql
CREATE TABLE branches (
  tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id        uuid NOT NULL DEFAULT gen_random_uuid(),
  name      text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, name)
);
-- Which branches a member works at (used when the role's data_scope is 'branch' or 'own')
CREATE TABLE member_branches (
  tenant_id uuid NOT NULL DEFAULT app_current_tenant(),
  user_id   uuid NOT NULL,
  branch_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, user_id, branch_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships (tenant_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE customers ADD COLUMN branch_id uuid,
  ADD FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id);
ALTER TABLE appointments ADD COLUMN branch_id uuid,
  ADD FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id);
CREATE INDEX customers_branch ON customers (tenant_id, branch_id);
CREATE INDEX appointments_branch ON appointments (tenant_id, branch_id);
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON branches
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
ALTER TABLE member_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_branches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_branches
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));

-- Scope variables, set by withMemberPermissions (or a job, explicitly)
CREATE FUNCTION app_data_scope() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.data_scope', true), '')
$$;
CREATE FUNCTION app_branch_ids() RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT string_to_array(NULLIF(current_setting('app.branch_ids', true), ''), ',')::uuid[]
$$;
CREATE FUNCTION app_actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid
$$;
```

```sql
-- AS RESTRICTIVE: ANDed with tenant_isolation. No scope set → no rows (fail closed).
-- Without WITH CHECK, USING also checks inserted and updated rows.
CREATE POLICY data_scope ON customers AS RESTRICTIVE
  USING (CASE (SELECT app_data_scope())
           WHEN 'tenant' THEN true
           WHEN 'branch' THEN branch_id = ANY ((SELECT app_branch_ids())::uuid[])
           WHEN 'own' THEN branch_id = ANY ((SELECT app_branch_ids())::uuid[])   -- own-scoped staff still find their branch's customers
           ELSE false END);
CREATE POLICY data_scope ON appointments AS RESTRICTIVE
  USING (CASE (SELECT app_data_scope())
           WHEN 'tenant' THEN true
           WHEN 'branch' THEN branch_id = ANY ((SELECT app_branch_ids())::uuid[])
           WHEN 'own' THEN staff_user_id = (SELECT app_actor_id())
           ELSE false END);
```

- The scope lives on the role and the branches on the member; `withMemberPermissions` sets `app.data_scope` and `app.branch_ids`. With fixed roles, put both on the membership.
- `AS RESTRICTIVE` policies are ANDed with `tenant_isolation`, and they fail closed: no scope set → no rows. A job sets it explicitly after `withTenant` (`SELECT set_config('app.data_scope', 'tenant', true)` for reminders across all branches).
- Rows without a branch are visible with tenant scope only.
- A `WHERE branch_id = ...` in code leaks the first time a query forgets it; the policy keeps the rule in one place. Without RLS (MySQL), the tenant-aware repository adds the filter, and tests cover every query.

## 5. Tests

`test/permissions.test.ts`, as the app role:

| Case | Expect |
|---|---|
| Manager's grants | `customer.write` and the customer update bit pass; the delete bit and `billing.manage` → 403; the owner passes everything |
| `role_access_matrix`; writing `permissions` or `modules` | bits as booleans; 42501; the catalog equals the `Action` list |
| Tenant A lists, loads or assigns tenant B's role; sets it in SQL | not listed, null, 404, `23503` (composite FK) |
| Manager adds `billing.manage` or the delete bit to a role; branch lead widens a role to tenant scope; manager edits a role above them | 403 each; a change within their grants → ok |
| Manager assigns themselves the owner role or a role above them, or changes the owner's role; receptionist assigns anything | 403 each |
| Edit the owner role in code / `UPDATE` or `DELETE` it in SQL | 409 `owner_role_locked` / trigger error |
| The last owner steps down; two owners demote each other at once, 10 times | 409 `last_owner`; exactly one succeeds, one owner left |
| Owner removes `customer.read` from the receptionist's role | the next request → 403 |
| Branch-scoped receptionist; tenant-scoped manager; branch lead inserts into another branch | own branch only; all customers; 42501 |
| A job without scope / with `tenant` scope | 0 rows / all rows |
| Technician with `own` scope | only their own appointments |
