# Postgres RLS for multi-tenancy: details and pitfalls

Ran on PostgreSQL 16 and Node 22 (pg 8.23) as the app role: no tenant context returns 0 rows; a member of tenant B gets 404 on tenant A's path even with `app.user_id` leaked onto the connection; workers see tenants only through `app_tenant_ids()`; the app role cannot change append-only or read-only tables. Removing the membership predicate or a REVOKE failed a test. The Supabase policies ran against a stub of `auth.uid()`, not on Supabase.

## Contents
1. Roles and privileges
2. Policies for tenant-owned tables
3. Before a tenant exists: login, workspace selection, workers
4. Setting tenant context per request: pg, Prisma, Drizzle, TypeORM, Sequelize, GORM, ActiveRecord, SQLAlchemy, Django
5. Data migrations, backfills, backups with FORCE enabled
6. Supabase
7. Common pitfalls
8. Quick check queries

## 1. Roles and privileges

Separate five roles:

| Role | Used for | Attributes |
|---|---|---|
| table owner (e.g. `app_owner`) | schema migrations (DDL) | not superuser |
| `app_user` | the running app and its workers | `NOSUPERUSER NOBYPASSRLS`, not owner |
| `app_backup` | `pg_dump` | `BYPASSRLS` + `pg_read_all_data` (read-only, includes tables created later) |
| `app_maintenance` | data backfills, retention purges, approved ops jobs | `BYPASSRLS` + `pg_read_all_data` + `pg_write_all_data`, used only deliberately (section 5) |
| `app_definer` | owns the few `SECURITY DEFINER` functions (`app_tenant_ids()`, section 3) | `NOLOGIN BYPASSRLS` |

```sql
-- Migrations (DDL) run as the table owner; the app never connects as it
CREATE ROLE app_owner LOGIN PASSWORD 'change-me' NOSUPERUSER;
GRANT USAGE, CREATE ON SCHEMA public TO app_owner;

CREATE ROLE app_user LOGIN PASSWORD 'change-me' NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
-- Tables and sequences created later by migrations (app_owner). FOR ROLE is required: without it
-- the defaults apply only to objects created by whoever runs this command (e.g. admin), not app_owner.
-- These defaults include UPDATE and DELETE: append-only and read-only tables revoke them (below).
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
-- Stop hung queries from affecting other tenants
ALTER ROLE app_user SET statement_timeout = '5s';

-- Backup and backfill (Postgres 14+): the predefined roles pg_read_all_data/pg_write_all_data cover every table,
-- including ones created later, so new tables don't cause "permission denied". Creating BYPASSRLS roles requires superuser.
CREATE ROLE app_backup LOGIN PASSWORD 'change-me' BYPASSRLS;
GRANT pg_read_all_data TO app_backup;
CREATE ROLE app_maintenance LOGIN PASSWORD 'change-me' BYPASSRLS;
GRANT pg_read_all_data, pg_write_all_data TO app_maintenance;

-- Owns the few SECURITY DEFINER functions (app_tenant_ids, section 3). NOLOGIN: nobody connects as it.
CREATE ROLE app_definer NOLOGIN NOSUPERUSER BYPASSRLS;
GRANT USAGE ON SCHEMA public TO app_definer;
```

**Append-only and read-only tables.** The default privileges give `app_user` UPDATE and DELETE on every new table. In the migration that creates such a table, revoke what the app must not do, and add the table to the fourth check in section 8:

| Kind | Examples | Revoke from `app_user` |
|---|---|---|
| Append-only (evidence) | `audit_log` (`references/auth.md` section 8), `consents` (`references/privacy.md` section 3) | `UPDATE, DELETE, TRUNCATE` |
| Global, read-only (no `tenant_id`, no RLS) | `tenant_domains` (section 3), `consent_purposes`, plans, province lists | `INSERT, UPDATE, DELETE, TRUNCATE` |

Without the REVOKE, "append-only" is only a comment: any bug or injected query can rewrite the evidence. Retention purges run as `app_maintenance`.

Managed DBs (RDS, Cloud SQL, Neon, Supabase...) often come with their own roles; the principle stays: the app's role must not bypass RLS.

## 2. Policies for tenant-owned tables

```sql
-- Read the current tenant. NULLIF: after a transaction with set_config(..., true) ends,
-- that connection returns '' instead of NULL, and ''::uuid raises an error.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;   -- applies to the table owner too
CREATE POLICY tenant_isolation ON customers
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointments
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
```

- With no context, `app_current_tenant()` is NULL, the condition is NULL, and the result is 0 rows (fail closed).
- `(SELECT ...)` lets Postgres compute the value once per statement instead of per row.
- For ordinary business tables, one `FOR ALL` policy comparing only `tenant_id` as above is enough and safe.
- **Never add `OR ...` to a `FOR ALL` policy.** `USING` also decides which rows can be UPDATEd/DELETEd, so every `OR` branch widens write access, not just read. For wider reads, add a separate `FOR SELECT` policy (section 3).
- `tenant_id` can fill itself: `tenant_id uuid NOT NULL DEFAULT app_current_tenant()` (the schema in `references/multi-tenant.md` section 2). The policy still checks it in `WITH CHECK`.

## 3. Before a tenant exists: login, workspace selection, workers

At login or workspace selection there is no tenant context yet, but you still need to list the tenants the user belongs to:

- **Only in the login / workspace-selection flow**, the server sets `app.user_id` (from the authenticated session, per transaction: `listWorkspaces` in section 4). Business requests set `app.tenant_id` and the actor variables (section 4), never `app.user_id`. That way a "list this workspace's members" query never mixes in the user's memberships in other tenants.
- `memberships` and `tenants` get a **read policy** that allows by user, and **write policies** limited to the current tenant:

```sql
CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- memberships
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON memberships FOR SELECT
  USING (tenant_id = (SELECT app_current_tenant()) OR user_id = (SELECT app_current_user()));
CREATE POLICY membership_insert ON memberships FOR INSERT
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
CREATE POLICY membership_update ON memberships FOR UPDATE
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
CREATE POLICY membership_delete ON memberships FOR DELETE
  USING (tenant_id = (SELECT app_current_tenant()));

-- tenants
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON tenants FOR SELECT
  USING (id = (SELECT app_current_tenant())
         OR id IN (SELECT m.tenant_id FROM memberships m WHERE m.user_id = (SELECT app_current_user())));
CREATE POLICY tenant_insert ON tenants FOR INSERT
  WITH CHECK (id = (SELECT app_current_tenant()));
CREATE POLICY tenant_update ON tenants FOR UPDATE
  USING (id = (SELECT app_current_tenant()))
  WITH CHECK (id = (SELECT app_current_tenant()));
CREATE POLICY tenant_delete ON tenants FOR DELETE
  USING (id = (SELECT app_current_tenant()));
```

- **List the user's workspaces**: `listWorkspaces` (section 4) sets only `app.user_id`, then queries `memberships JOIN tenants`.
- **Sign up a new tenant**: `createTenant` (section 4) generates the tenant id in the app, sets it as `app.tenant_id`, then inserts `tenants` and the owner membership. Inserting a membership for another tenant is blocked by policy.
- **Workers listing tenants** (reminders, expiry and deadline jobs, purges): a worker has no context, so `tenant_read` shows it 0 rows and `SELECT id FROM tenants` silently returns nothing: every "for each tenant" job does nothing, with no error. Give workers one narrow cross-tenant read:

```sql
-- Ids of active tenants, nothing else. Run as a superuser: the new owner has BYPASSRLS.
CREATE FUNCTION app_tenant_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM public.tenants WHERE status = 'active' ORDER BY id
$$;
GRANT SELECT (id, status) ON tenants TO app_definer;
ALTER FUNCTION app_tenant_ids() OWNER TO app_definer;
REVOKE ALL ON FUNCTION app_tenant_ids() FROM PUBLIC;      -- every role may run a new function by default
GRANT EXECUTE ON FUNCTION app_tenant_ids() TO app_user;   -- or only the worker's role, if it has its own
```

  Jobs loop over `SELECT id FROM app_tenant_ids() AS id` and do everything else inside `withTenant` (`references/jobs.md`). Keep the function this narrow (ids of active tenants, no parameters) and include it in restore drills (section 7, pitfall 8).
- **Look up a tenant by slug/subdomain before login**: slugs and domains are public anyway (they're in the URL), so put them in a small mapping table without RLS that the app can only read. No function or BYPASSRLS owner needed:

```sql
CREATE TABLE tenant_domains (
  slug      text PRIMARY KEY,          -- e.g. 'spa-hoa-mai' or 'hoamai.example.com'
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);
-- Read-only. ALTER DEFAULT PRIVILEGES in section 1 already granted app_user write access on every new table,
-- so revoke it: this table has no RLS, and write access means repointing another tenant's slug to your own.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON tenant_domains FROM app_user;
GRANT SELECT ON tenant_domains TO app_user;
-- Adding/changing slugs: a separate admin flow (another role or a permission-checked function), with audit log
```

  Put nothing in this table except slug and id. After resolving `tenant_id` from the slug, the server must still check the user has a membership in that tenant.

## 4. Setting tenant context per request

Rule: each request (or unit of work) runs in one transaction whose first statement is `set_config('app.tenant_id', <tenant>, true)`. The third argument `true` scopes the value to the transaction, so a connection returned to the pool no longer carries the old tenant.

The tenant comes from the request path (`/v1/t/{tenantId}/...`; validate it as a uuid first, bad format → 404). Right after `set_config`, in the same transaction, check that the session user is a member **of the current tenant**, with `tenant_id = app_current_tenant()` in the query: no row → 404.

| Variable | Set by | Read by |
|---|---|---|
| `app.tenant_id` | `withTenant` (tenant from the path or the job payload) | every tenant policy |
| `app.user_id` | `listWorkspaces` only | the `memberships` and `tenants` read policies |
| `app.actor_id`, `app.member_role` | `withMember`, after the membership check (`withApiKey` sets `app.actor_id` to the key id) | role-gated policies and triggers; never the `memberships`/`tenants` policies |

The predicate matters: `membership_read` also matches `app.user_id`, so if anything ever sets it in a business request (a session-level `SET`, a helper reused from the login flow), a member of tenant B calling tenant A's path finds their own B row and passes the check. Tested both ways.

### node-postgres (pg)

```ts
// src/db/tenant.ts
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Role, UserActor } from '../shared/authz';
import { NotFoundError } from '../shared/errors';

export async function withTransaction<T>(pool: Pool, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function withTenant<T>(pool: Pool, tenantId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(pool, async (db) => {
    await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return fn(db);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Business requests: tenant from the path, user from the authenticated session
export async function withMember<T>(
  pool: Pool, tenantId: string, userId: string,
  fn: (db: PoolClient, actor: UserActor) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) throw new NotFoundError();   // malformed id: 404, not a 500 from ::uuid
  return withTenant(pool, tenantId, async (db) => {
    // Filter on the current tenant: membership_read alone also matches app.user_id (see above)
    const { rows } = await db.query<{ role: Role }>(
      'SELECT role FROM memberships WHERE tenant_id = app_current_tenant() AND user_id = $1', [userId]);
    const role = rows[0]?.role;
    if (!role) throw new NotFoundError();                // not a member: 404, don't reveal whether the tenant exists
    // Actor context for role-gated policies and triggers; memberships/tenants policies never read it
    await db.query("SELECT set_config('app.actor_id', $1, true), set_config('app.member_role', $2, true)", [userId, role]);
    return fn(db, { type: 'user', id: userId, role });
  });
}

// Login and workspace picker only: the one place that sets app.user_id
export function listWorkspaces(pool: Pool, userId: string) {
  return withTransaction(pool, async (db) => {
    await db.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const { rows } = await db.query<{ id: string; name: string; role: Role }>(
      `SELECT t.id, t.name, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1 AND t.status = 'active' ORDER BY t.name`, [userId]);
    return rows;
  });
}

// Sign-up: the new id is the tenant context, so the policies allow this tenant and its owner membership only
export async function createTenant(pool: Pool, ownerId: string, name: string): Promise<string> {
  const tenantId = randomUUID();
  await withTenant(pool, tenantId, async (db) => {
    await db.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [tenantId, name]);
    await db.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [tenantId, ownerId]);
  });
  return tenantId;
}
```

`NotFoundError` is a project error mapped to 404; `Role`, `UserActor`: `references/auth.md` section 4.

A role-gated policy reads `app.member_role`. Example: health notes for owners and managers only, checked in the API and again in the DB:

```sql
-- Set by withMember after the membership check. Read by role-gated policies, never by memberships/tenants policies.
CREATE OR REPLACE FUNCTION app_member_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.member_role', true), '')
$$;

-- Health notes are sensitive data (references/privacy.md section 5): owners and managers only, in the DB too
CREATE TABLE customer_health_notes (
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  customer_id uuid NOT NULL,
  note        text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE customer_health_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_health_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY by_role ON customer_health_notes
  USING (tenant_id = (SELECT app_current_tenant()) AND (SELECT app_member_role()) IN ('owner', 'manager'))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()) AND (SELECT app_member_role()) IN ('owner', 'manager'));
```

### Prisma

Use an interactive transaction on the base client: every query of a unit of work goes through `tx`, and the first one sets the tenant. How you construct `PrismaClient` differs between majors (Prisma 7 uses a driver adapter and imports from the generated client folder), so create the client per the docs of the installed version.

```ts
import type { Prisma, PrismaClient } from '<đường dẫn client đã generate>';   // = path to your generated client

export async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

// tenantId comes from the path, membership already checked as in the pg example above
// await withTenant(prisma, tenantId, (tx) => tx.customer.findMany({ take: 20 }));
```

The "client extension wrapping every query" pattern in Prisma's example is only an illustration: each query becomes its own transaction, and that example's own docs warn that `$transaction` on an extended client may not behave as expected and is not meant for production. Don't use it as your main tenant isolation layer.

### Drizzle

```ts
import { sql } from 'drizzle-orm';

await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
  // ...every query uses tx
});
```

### TypeORM

```ts
await dataSource.transaction(async (manager) => {
  await manager.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  // ...every operation uses manager
});
```

### Sequelize

```js
await sequelize.transaction(async (t) => {
  await sequelize.query("SELECT set_config('app.tenant_id', :tid, true)", { replacements: { tid: tenantId }, transaction: t });
  // ...every call must pass { transaction: t }
});
```

### GORM (Go)

```go
err := db.Transaction(func(tx *gorm.DB) error {
    if err := tx.Exec("SELECT set_config('app.tenant_id', ?, true)", tenantID).Error; err != nil {
        return err
    }
    // ...every query uses tx
    return nil
})
```

### ActiveRecord (Rails)

```ruby
ActiveRecord::Base.transaction do
  ActiveRecord::Base.connection.execute(
    ActiveRecord::Base.sanitize_sql_array(["SELECT set_config('app.tenant_id', ?, true)", tenant_id])
  )
  # ...every query in this block
end
```

### SQLAlchemy

```python
from sqlalchemy import text

with Session(engine) as session, session.begin():
    session.execute(text("SELECT set_config('app.tenant_id', :tid, true)"), {"tid": str(tenant_id)})
    # ...every query in the same transaction
```

### Django

With `ATOMIC_REQUESTS = True` the transaction wraps only the view; middleware runs outside it. So set the context inside the view (a shared decorator or mixin):

```python
from functools import wraps
from django.db import connection, transaction

def tenant_scoped(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute("SELECT set_config('app.tenant_id', %s, true)", [str(request.tenant_id)])
            return view(request, *args, **kwargs)
    return wrapper
```

## 5. Data migrations, backfills, backups with FORCE enabled

`FORCE ROW LEVEL SECURITY` applies policies to the table owner too. Easy-to-miss consequences:

- **A backfill run as the owner role without tenant context UPDATEs 0 rows with no error.** If the "contract" step then drops the old column, the data is really gone.
- **`pg_dump` as the owner role** fails with `query would be affected by row-level security policy`.

What to do:

- Run backfills as `app_maintenance` and backups as `app_backup` (section 1), or backfill tenant by tenant with `set_config('app.tenant_id', ..., true)` in each transaction.
- **Always check the backfill's affected row count** (against a `count(*)` run as `app_maintenance`) before moving to the next step.
- DDL-only migrations (CREATE/ALTER) are not affected.

## 6. Supabase

Clients call the DB directly through Supabase's API, so RLS is the main protection, not just a safety net. This holds for **single-tenant apps too**: anyone with the anon key (it ships inside the web and mobile app) can query every table RLS doesn't protect.

- Enable RLS on every table in the `public` schema. A table without RLS is readable by anyone with the anon key.
- **One user's own data** (no workspaces): compare an owner column with `auth.uid()`, wrapped in `(SELECT ...)` so it runs once per statement, and index that column:

```sql
-- Single-tenant app: each user sees and changes only their own rows
CREATE TABLE public.notes (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  body    text NOT NULL
);
CREATE INDEX notes_user ON public.notes (user_id);   -- the column every policy filters on
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON public.notes FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
```

- **Multi-tenant**: policies are based on `auth.uid()` and the memberships table. Collect the user's tenant list in a `SECURITY DEFINER` function returning a set of ids, then use `IN (SELECT ...)`: Postgres computes the list once per statement. Calling a check function per row (e.g. `is_member(tenant_id)`) makes large tables noticeably slow. Functions created from the SQL editor are owned by Supabase's `postgres` role, which bypasses RLS, so they can read memberships.
- Put that function in a schema **not exposed through the API** (e.g. `private`), since functions in `public` can be called directly as RPCs.

```sql
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.user_tenant_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.tenant_id FROM public.memberships m WHERE m.user_id = auth.uid()
$$;

CREATE POLICY members_only ON public.customers FOR ALL TO authenticated
  USING (tenant_id IN (SELECT private.user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT private.user_tenant_ids()));
```

  This policy lets users see data of every tenant they belong to. Screens working inside one workspace must still filter by the selected workspace's `tenant_id`.
- Never put the `service_role` key in the client or FE code: it bypasses all RLS.
- Edge Functions or servers using `service_role` must check membership in code themselves.
- Supabase MCP (lets the agent view schema and logs, run SQL): connect only to a dev project, `read_only=true`, with `project_ref`; schema and policy changes still go through migration files in the repo. Details: the `vibe-plan` skill (`references/dev-tools.md`, section 7).

## 7. Common pitfalls

1. **Testing as superuser**: RLS is bypassed, tests pass even with wrong policies. Run tests as the app role.
2. **Policy casting `current_setting(...)::uuid` directly**: after a transaction with `set_config(..., true)` ends, that connection returns `''`, not NULL, and the next query fails with `invalid input syntax for type uuid`. Always use `NULLIF(..., '')` as in section 2.
3. **`OR` in a `FOR ALL` policy** opens UPDATE/DELETE too (a `memberships` policy with `OR user_id = app_current_user()` lets a user move their owner membership from tenant B to A): section 2; split as in section 3.
4. **Session-level `SET app.tenant_id`** with PgBouncer transaction pooling hands the previous request's tenant to the next one: `set_config(..., true)`, section 4.
5. **Plain FKs** accept another tenant's id (FK checks bypass RLS): composite FKs, `references/multi-tenant.md` section 2.
6. **Global unique constraints** tell tenant A that tenant B has a value: include `tenant_id` (`references/multi-tenant.md` section 2).
7. **Views bypass RLS** when the view owner is superuser or has BYPASSRLS, or owns the table and the table isn't `FORCE`d. On Postgres 15+ create views over tenant tables `WITH (security_invoker = true)` so you don't have to think about it.
8. **`SECURITY DEFINER` functions** run with the function owner's privileges: an owner with BYPASSRLS bypasses RLS; a table owner bypasses RLS if the table isn't `FORCE`d, and with `FORCE` is blocked and gets empty results. Functions owned by special roles also break easily on restore by a non-superuser (changing owner needs that role to have `CREATE` on the schema). Prefer designs that don't need them (section 3); if you must, own them by `app_definer`, keep them very narrow, always `SET search_path`, `REVOKE ... FROM PUBLIC`, accept only validated parameters, and include them in restore drills.
9. **Backfill as owner with `FORCE`**: 0 rows updated, no error (section 5).
10. **New table without RLS**: add the checks from section 8 to CI.
11. **Materialized views, analytics replicas, dumps/exports**: RLS isn't applied automatically like on the source table; filter by tenant when creating or accessing them.
12. **Performance**: policies calling a function per row and missing indexes led by `tenant_id` get slow on large tables.
13. **`app.user_id` in a business request** lets `membership_read` match the user's other tenants: section 4.
14. **A job selecting from `tenants`** gets 0 rows and does nothing: `app_tenant_ids()`, section 3.
15. **"Append-only" without REVOKE**: the default privileges allow UPDATE and DELETE (section 1).

## 8. Quick check queries

Put these in CI; each result must be empty except the third.

Tables with a `tenant_id` column that lack RLS or `FORCE` (list deliberately exempt tables such as `tenant_domains` in `NOT IN`; the fourth query checks the app can only read them):

```sql
SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relname NOT IN ('tenant_domains')   -- tables deliberately exempt from RLS
  AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
```

Tables with RLS enabled but no policy (every query returns 0 rows):

```sql
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
  AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname);
```

Does the app role bypass anything (both columns must be false):

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user';
```

Append-only and read-only tables the app role can still change:

```sql
-- List every append-only and read-only table here when you create it
SELECT t.name, t.kind, p.priv
FROM (VALUES ('audit_log', 'append-only'), ('tenant_domains', 'read-only')) AS t(name, kind)
CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
WHERE (p.priv <> 'INSERT' OR t.kind = 'read-only')
  AND CASE WHEN p.priv IN ('INSERT', 'UPDATE')
           THEN has_any_column_privilege('app_user', 'public.' || t.name, p.priv)   -- table or column grants
           ELSE has_table_privilege('app_user', 'public.' || t.name, p.priv) END
ORDER BY t.name, p.priv;
```
