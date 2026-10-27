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
{{sql/roles.sql}}
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
{{sql/current-tenant.sql}}

{{sql/tenant-isolation.sql}}
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
{{sql/login.sql}}
```

- **List the user's workspaces**: `listWorkspaces` (section 4) sets only `app.user_id`, then queries `memberships JOIN tenants`.
- **Sign up a new tenant**: `createTenant` (section 4) generates the tenant id in the app, sets it as `app.tenant_id`, then inserts `tenants` and the owner membership. Inserting a membership for another tenant is blocked by policy.
- **Workers listing tenants** (reminders, expiry and deadline jobs, purges): a worker has no context, so `tenant_read` shows it 0 rows and `SELECT id FROM tenants` silently returns nothing: every "for each tenant" job does nothing, with no error. Give workers one narrow cross-tenant read:

```sql
{{sql/tenant-ids.sql}}
```

  Jobs loop over `SELECT id FROM app_tenant_ids() AS id` and do everything else inside `withTenant` (`references/jobs.md`). Keep the function this narrow (ids of active tenants, no parameters) and include it in restore drills (section 7, pitfall 8).
- **Look up a tenant by slug/subdomain before login**: slugs and domains are public anyway (they're in the URL), so put them in a small mapping table without RLS that the app can only read. No function or BYPASSRLS owner needed:

```sql
{{sql/tenant-domains.sql}}
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
{{src/db/tenant.ts}}
```

`NotFoundError` is a project error mapped to 404; `Role`, `UserActor`: `references/auth.md` section 4.

A role-gated policy reads `app.member_role`. Example: health notes for owners and managers only, checked in the API and again in the DB:

```sql
{{sql/member-role.sql}}
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
{{sql/supabase-own-rows.sql}}
```

- **Multi-tenant**: policies are based on `auth.uid()` and the memberships table. Collect the user's tenant list in a `SECURITY DEFINER` function returning a set of ids, then use `IN (SELECT ...)`: Postgres computes the list once per statement. Calling a check function per row (e.g. `is_member(tenant_id)`) makes large tables noticeably slow. Functions created from the SQL editor are owned by Supabase's `postgres` role, which bypasses RLS, so they can read memberships.
- Put that function in a schema **not exposed through the API** (e.g. `private`), since functions in `public` can be called directly as RPCs.

```sql
{{sql/supabase.sql}}
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
{{sql/ci/1-missing-rls.sql}}
```

Tables with RLS enabled but no policy (every query returns 0 rows):

```sql
{{sql/ci/2-no-policy.sql}}
```

Does the app role bypass anything (both columns must be false):

```sql
{{sql/ci/3-app-role.sql}}
```

Append-only and read-only tables the app role can still change:

```sql
{{sql/ci/4-append-only.sql}}
```
