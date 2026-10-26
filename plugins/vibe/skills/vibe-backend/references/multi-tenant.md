# Multi-tenant DB: isolate customer data from the schema up

In multi-tenant SaaS the costliest incident is not slowness or downtime but customer A seeing customer B's data. It usually comes from one query that forgot the tenant condition. This guide pushes isolation down to the database so one slip doesn't become an incident.

Examples use PostgreSQL. The principles hold for other DBs, except the RLS parts.

## 1. Choose the tenancy model (hard to reverse, decide early)

| Model | Fits | Cost |
|---|---|---|
| **Shared schema + `tenant_id` + RLS** (default) | Many small and mid-size tenants, typical B2B SaaS | Needs scoping discipline; covered by RLS + tests |
| Schema-per-tenant | Tens to hundreds of tenants needing customization | Migrations run N times; pools and `search_path` get complex |
| Database-per-tenant | Enterprise, legal requirements, per-customer backup/restore | Heavy operations, high cost |

Hybrids work: regular tenants share, enterprise tenants get their own DB. Record the decision and reasons in `ARCHITECTURE.md`.

## 2. Schema rules (shared schema)

1. Have a `tenants` table. `users` is global, since one person can belong to several tenants; the link is `memberships(tenant_id, user_id, role)`.
2. Every tenant-owned table has `tenant_id uuid NOT NULL REFERENCES tenants(id)`. Keep global tables (plans, province lists...) clearly separate: no `tenant_id`, read-only for tenants.
3. **Composite FKs block cross-tenant references:**
   ```sql
   CREATE TABLE customers (
     id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id  uuid NOT NULL REFERENCES tenants(id),
     email      text,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (tenant_id, id),
     UNIQUE (tenant_id, email)
   );

   CREATE TABLE orders (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id   uuid NOT NULL REFERENCES tenants(id),
     customer_id uuid NOT NULL,
     FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id)
   );
   ```
   With a plain FK (`customer_id REFERENCES customers(id)`), a bug can attach tenant A's order to tenant B's customer and the DB accepts it. A composite FK makes the DB reject it.
4. **Unique per tenant**: `UNIQUE (tenant_id, email)`, not `UNIQUE (email)`, unless the value is truly global. A global unique also leaks information: tenant A tries an email, gets a duplicate error, and learns another tenant has it.
5. **Indexes start with `tenant_id`**, matching how you query: `(tenant_id, created_at DESC)`, `(tenant_id, status)`.
6. **IDs**: UUID (`uuidv7()` built in from Postgres 18; older versions use `gen_random_uuid()` or generate in the app). Never expose auto-increment IDs in the API.
7. **Tenant deletion and data export**: design them from the start (`ON DELETE` strategy, batched delete jobs); customers will ask sooner or later.

## 3. Row Level Security: the DB-level safety net

Enable RLS on every tenant-owned table, with policies reading the current tenant from a transaction variable. Sample SQL, per-ORM context setup (pg, Prisma, Drizzle, TypeORM, Sequelize, GORM, ActiveRecord, SQLAlchemy, Django), Supabase, and the pitfall list are in `references/postgres-rls.md`. Read it before writing the project's first RLS migration.

Four things you must not get wrong:

- **The app connects as a regular role**: not superuser, not `BYPASSRLS`, not the table owner (or the table has `FORCE ROW LEVEL SECURITY`). Superusers bypass RLS, so tests run as superuser pass even when RLS doesn't work.
- **Set the tenant per transaction** (`set_config('app.tenant_id', $1, true)`), not per session. With a connection pool, a session-level setting leaks the previous request's tenant into the next request on the same connection.
- **No tenant context means no rows** (fail closed), not all rows.
- **Never add `OR ...` to a `FOR ALL` policy**: the `OR` branch opens update and delete too, not just read. `memberships` and `tenants`, which must be readable by user at login, get separate read and write policies (`references/postgres-rls.md` section 3).

## 4. Outside the database

The tenant travels with the data everywhere:

- The server takes the tenant from the request path (`/v1/t/{tenantId}/...`) and checks on every request that the session user is a member (not a member → 404); never trust `tenant_id` in body/query (`references/api-conventions.md` section 5).
- Jobs / queues: the payload carries `tenant_id`; the worker sets tenant context before touching the DB; cron iterates tenants explicitly, one at a time.
- Cache keys `t:{tenant_id}:...`; object storage prefix `tenants/{tenant_id}/`; search indexes, analytics and logs all have a `tenant_id` field.
- Admin/support needing cross-tenant views: a separate role and code path, with an audit log. Never "turn off RLS to save time".
- Noisy neighbors: per-tenant rate limits and quotas, `statement_timeout` on the app role.

## 5. Safe migrations

- **Expand → migrate → contract**: add a nullable column, backfill in batches, add constraints, remove the old thing only after the new code runs fine.
- **Backfill on a `FORCE` table**: run as the owner role without tenant context and it updates 0 rows with no error; `pg_dump` as owner also fails. Run backfills/backups as a maintenance role with BYPASSRLS (or loop over tenants with `set_config`), and check the affected row count before the contract step (`references/postgres-rls.md` section 5). Skip this and dropping the old column also deletes the data that was never moved.
- Put `SET lock_timeout = '5s'` at the top of migrations: an ALTER waiting for a lock blocks every query queued behind it, so failing early and rerunning beats hanging the whole system.
- `NOT NULL` on a large table: `ADD CONSTRAINT ... CHECK (col IS NOT NULL) NOT VALID`, then `VALIDATE CONSTRAINT`, then `SET NOT NULL` (Postgres 12+ skips the table scan when a valid CHECK exists), then drop the helper CHECK.
- New FK on a table with data: `NOT VALID`, then `VALIDATE CONSTRAINT` in a separate step.
- Indexes on large tables: `CREATE INDEX CONCURRENTLY`. It cannot run inside a transaction, so disable the migration tool's transaction for that migration.
- New tenant-owned table: create the table, enable RLS, `FORCE`, policies and indexes in the same migration, so the table never exists without RLS.
- Only one task/agent creates migrations at a time (declare `touches: [.../migrations/**]`), so migration order doesn't collide.

## 6. Tenant isolation tests

Mandatory for every endpoint touching tenant data. Create 2 tenants A and B with data. Log in as A and try to read / update / delete B's resources by id: must be 404. A's lists contain none of B's data. A `tenant_id` sent by the client is ignored. Test RLS directly in the DB as the app role; with no context, 0 rows. Test template (table-driven, covers new routes automatically) in `references/isolation-tests.md`.

## Reviewing an existing schema

Go through: which tenant-owned tables lack `tenant_id`? Which FKs aren't composite? Which unique constraints/indexes lack `tenant_id`? Is RLS enabled and `FORCE`d, and can the app role bypass it? Does any `FOR ALL` policy have an `OR` branch? Is context set per session or per transaction? Which role runs backfills/backups? Do jobs, cache and storage carry the tenant? Are there isolation tests?

Report by severity: **Critical** (can leak data) → **Should fix** → **Suggestion**. Each item comes with a safe fix migration per section 5.
