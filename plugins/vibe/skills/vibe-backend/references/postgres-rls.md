# Postgres RLS for multi-tenancy: details and pitfalls

Every SQL snippet in this file was run on PostgreSQL 16, including the "attack" tests in the Pitfalls section.

## Contents
1. Roles and privileges
2. Policies for tenant-owned tables
3. Login and workspace selection (before a tenant exists)
4. Setting tenant context per request: pg, Prisma, Drizzle, TypeORM, Sequelize, GORM, ActiveRecord, SQLAlchemy, Django
5. Data migrations, backfills, backups with FORCE enabled
6. Supabase
7. Common pitfalls
8. Quick check queries

## 1. Roles and privileges

Separate four roles:

| Role | Used for | Attributes |
|---|---|---|
| table owner (e.g. `app_owner`) | schema migrations (DDL) | not superuser |
| `app_user` | the running app | `NOSUPERUSER NOBYPASSRLS`, not owner |
| `app_backup` | `pg_dump` | `BYPASSRLS` + `pg_read_all_data` (read-only, includes tables created later) |
| `app_maintenance` | data backfills, approved ops jobs | `BYPASSRLS` + `pg_read_all_data` + `pg_write_all_data`, used only deliberately (section 5) |

```sql
CREATE ROLE app_user LOGIN PASSWORD 'change-me' NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
-- Tables and sequences created later by migrations (app_owner). FOR ROLE is required: without it
-- the defaults apply only to objects created by whoever runs this command (e.g. admin), not app_owner.
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
```

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
```

- With no context, `app_current_tenant()` is NULL, the condition is NULL, and the result is 0 rows (fail closed).
- `(SELECT ...)` lets Postgres compute the value once per statement instead of per row.
- For ordinary business tables, one `FOR ALL` policy comparing only `tenant_id` as above is enough and safe.
- **Never add `OR ...` to a `FOR ALL` policy.** `USING` also decides which rows can be UPDATEd/DELETEd, so every `OR` branch widens write access, not just read. For wider reads, add a separate `FOR SELECT` policy (section 3).
- `tenant_id` can fill itself: `tenant_id uuid NOT NULL DEFAULT app_current_tenant()`. The policy still checks it in `WITH CHECK`.

## 3. Login and workspace selection (before a tenant exists)

At login or workspace selection there is no tenant context yet, but you still need to list the tenants the user belongs to. How:

- **Only in the login / workspace-selection flow**, the server sets `app.user_id` (from the authenticated session, per transaction). Normal business requests set only `app.tenant_id` (tenant from the path, membership checked as in section 4). That way a "list this workspace's members" query never mixes in the user's memberships in other tenants.
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

- **List the user's workspaces**: set only `app.user_id`, then query `memberships JOIN tenants`.
- **Sign up a new tenant**: generate the tenant id in the app, set `app.tenant_id` = new id in the transaction, then insert `tenants` and the owner membership. Inserting a membership for another tenant is blocked by policy.
- **Look up a tenant by slug/subdomain before login**: slugs and domains are public anyway (they're in the URL), so put them in a small mapping table without RLS that the app can only read. Simpler than a `SECURITY DEFINER` function + BYPASSRLS role, and no ownership trouble on backup/restore (section 7, pitfall 8).

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

The tenant comes from the request path (`/v1/t/{tenantId}/...`; validate it as a uuid first, bad format → 404). Right after `set_config`, in the same transaction, check that the session user is a member: the `memberships` read policy filters by current tenant, so the query below sees only that tenant's memberships; no row means the user doesn't belong to this tenant → 404.

### node-postgres (pg)

```ts
import type { Pool, PoolClient } from 'pg';

export async function withTenant<T>(pool: Pool, tenantId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
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

// Middleware for business requests: tenant from the path, user from the authenticated session (NotFoundError is a project error mapped to 404)
export async function withMember<T>(
  pool: Pool, tenantId: string, userId: string,
  fn: (db: PoolClient, role: string) => Promise<T>,
): Promise<T> {
  return withTenant(pool, tenantId, async (db) => {
    const { rows } = await db.query<{ role: string }>('SELECT role FROM memberships WHERE user_id = $1', [userId]);
    if (rows.length === 0) throw new NotFoundError();   // not a member: 404, don't reveal whether the tenant exists
    return fn(db, rows[0]!.role);
  });
}
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

Clients call the DB directly through Supabase's API, so RLS is the main protection, not just a safety net.

- Enable RLS on every table in the `public` schema. A table without RLS is readable by anyone with the anon key.
- Policies are based on `auth.uid()` and the memberships table. Collect the user's tenant list in a `SECURITY DEFINER` function returning a set of ids, then use `IN (SELECT ...)`: Postgres computes the list once per statement. Calling a check function per row (e.g. `is_member(tenant_id)`) makes large tables noticeably slow. Functions created from the SQL editor are owned by Supabase's `postgres` role, which bypasses RLS, so they can read memberships.
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
3. **`OR` in a `FOR ALL` policy**: the `OR` branch also opens UPDATE/DELETE. E.g. a `memberships` policy with `OR user_id = app_current_user()` lets a user move their own owner membership from tenant B to tenant A. Split read and write policies as in section 3.
4. **Session-level `SET app.tenant_id = ...` + PgBouncer transaction pooling**: the next request gets the previous request's tenant. Use `set_config(..., true)` inside the transaction.
5. **Plain FKs don't block cross-tenant references**: FK checks bypass RLS, so `customer_id REFERENCES customers(id)` still accepts another tenant's customer id. Use a composite FK `(tenant_id, customer_id)`.
6. **Global unique leaks data**: tenant A inserting an email that tenant B already has gets a unique error, i.e. learns B has that email. Unique constraints must include `tenant_id`.
7. **Views bypass RLS** when the view owner is superuser or has BYPASSRLS, or owns the table and the table isn't `FORCE`d. On Postgres 15+ create views over tenant tables `WITH (security_invoker = true)` so you don't have to think about it.
8. **`SECURITY DEFINER` functions** run with the function owner's privileges: an owner with BYPASSRLS bypasses RLS; a table owner bypasses RLS if the table isn't `FORCE`d, and with `FORCE` is blocked and gets empty results. Functions owned by special roles also break easily on restore by a non-superuser (changing owner needs that role to have `CREATE` on the schema). Prefer designs that don't need them (section 3); if you must, keep the function very narrow, always `SET search_path`, accept only validated parameters, and include it in restore drills.
9. **Backfill as owner with `FORCE`**: 0 rows updated, no error (section 5).
10. **New table without RLS**: add the check from section 8 to CI.
11. **Materialized views, analytics replicas, dumps/exports**: RLS isn't applied automatically like on the source table; filter by tenant when creating or accessing them.
12. **Performance**: policies calling a function per row and missing indexes led by `tenant_id` get slow on large tables.

## 8. Quick check queries

Tables with a `tenant_id` column that lack RLS or `FORCE` (put in CI, result must be empty; list deliberately exempt tables such as `tenant_domains` in `NOT IN`, and add a separate check that the app role can only read them, like the fourth query below):

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

RLS-exempt tables the app role can still write (result must be empty):

```sql
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'app_user' AND table_schema = 'public'
  AND table_name IN ('tenant_domains')
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
```
