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
{{sql/custom-roles.sql}}
```

```sql
{{sql/role-permissions.sql}}
```

```sql
{{sql/role-bits.sql}}
```

```ts
{{src/permissions/grants.ts}}
```

```ts
{{src/permissions/edit-role.ts}}
```

- **Resolve once per request**, in the request's transaction: `withMemberPermissions` wraps `withMember` (`references/postgres-rls.md` section 4; the membership check and its 404 stay), and every check is one call: `requirePermission(actor, 'customer.write')` or `requireBits(actor, 'customer', 'update')`. Don't call `authorize` there: it reads `memberships.role`, which this model keeps only as a label.
- **No stale grants**: never put permissions in the access token or a process cache. If you must cache, key it by a version that every role edit bumps.
- **No escalation**: editing or assigning a role requires holding everything the role has and gets: permissions, bits and scope (`within`). Only owners hand out the owner role.
- **The owner role** is created at sign-up and means every permission; the code returns 409 on any edit and a trigger refuses changes in SQL. A tenant keeps an owner: lock the owner assignments `FOR UPDATE` before counting, as in `references/auth.md` section 5. Removing a member (the membership delete cascades to `member_roles`) needs the same check.
- **Tenant isolation**: RLS on every role table, and composite FKs `(tenant_id, role_id)`, so another tenant's role is neither visible nor assignable.
- **Catalogs** (`permissions`, `modules`) are global and read-only for the app role; a migration adds entries. A test checks that `permissions` matches the `Action` list.

## 4. Data scope: own, branch, tenant

```sql
{{sql/branches.sql}}
```

```sql
{{sql/data-scope.sql}}
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
