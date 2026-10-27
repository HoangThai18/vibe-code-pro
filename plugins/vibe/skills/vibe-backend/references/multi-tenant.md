# Multi-tenant DB: isolate customer data from the schema up

In multi-tenant SaaS the costliest incident is not slowness or downtime but customer A seeing customer B's data. It usually comes from one query that forgot the tenant condition. This guide pushes isolation down to the database so one slip doesn't become an incident.

Examples use PostgreSQL. The principles hold for other DBs, except the RLS parts. The schema in section 2 ran on PostgreSQL 16 with the policies from `references/postgres-rls.md`.

## 1. Choose the tenancy model (hard to reverse, decide early)

| Model | Fits | Cost |
|---|---|---|
| **Shared schema + `tenant_id` + RLS** (default) | Many small and mid-size tenants, typical B2B SaaS | Needs scoping discipline; covered by RLS + tests |
| Schema-per-tenant | Tens to hundreds of tenants needing customization | Migrations run N times; pools and `search_path` get complex |
| Database-per-tenant | Enterprise, legal requirements, per-customer backup/restore | Heavy operations, high cost |

Hybrids work: regular tenants share, enterprise tenants get their own DB. Record the decision and reasons in `ARCHITECTURE.md`.

## 2. Schema rules (shared schema)

1. Have a `tenants` table. `users` is global, since one person can belong to several tenants; the link is `memberships(tenant_id, user_id, role)`.
2. Every tenant-owned table has `tenant_id uuid NOT NULL REFERENCES tenants(id)`. Keep global tables (plans, province lists...) clearly separate: no `tenant_id`, and read-only for the app role (`REVOKE INSERT, UPDATE, DELETE, TRUNCATE`, `references/postgres-rls.md` section 1).
3. **Composite FKs block cross-tenant references**: `FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id)`. With a plain FK (`customer_id REFERENCES customers(id)`), a bug can attach tenant A's appointment to tenant B's customer and the DB accepts it (FK checks bypass RLS). A composite FK makes the DB reject it.
4. **Unique per tenant**: `UNIQUE (tenant_id, phone)`, not `UNIQUE (phone)`, unless the value is truly global (a login email in `users`). A global unique also leaks information: tenant A tries a phone number, gets a duplicate error, and learns another tenant has it.
5. **Keys and indexes start with `tenant_id`**, matching how you query: `PRIMARY KEY (tenant_id, id)`, `(tenant_id, starts_at)`, `(tenant_id, status)`.
6. **IDs**: UUID (`uuidv7()` built in from Postgres 18; older versions use `gen_random_uuid()` or generate in the app). Never expose auto-increment IDs in the API.
7. **Tenant deletion and data export**: design them from the start (`ON DELETE` strategy, batched delete jobs); customers will ask sooner or later.

### The example schema

Every example in this pack (all `vibe-*` skills and their tests) uses these tables and columns. Add your own columns; keep these names:

```sql
-- The example schema every reference uses. DEFAULT app_current_tenant(): references/postgres-rls.md section 2
CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  time_zone  text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',   -- IANA name; its CHECK: the vibe-frontend skill (references/i18n.md)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Global: one person can belong to several tenants
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text,                                    -- NULL: signs in with Apple/Google only
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  tenant_id  uuid NOT NULL REFERENCES tenants (id),
  user_id    uuid NOT NULL REFERENCES users (id),
  role       text NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX memberships_user ON memberships (user_id);

CREATE TABLE customers (
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  full_name  text NOT NULL CHECK (full_name IS NFC NORMALIZED AND length(full_name) BETWEEN 1 AND 200),
  phone      text NOT NULL CHECK (phone ~ '^0[0-9]{9,10}$'),   -- stored as 0912345678
  email      text,
  birthday   date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, phone)
);

CREATE TABLE appointments (
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL,
  staff_user_id uuid NOT NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'booked'
                CHECK (status IN ('booked', 'confirmed', 'done', 'cancelled', 'no_show')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id),
  FOREIGN KEY (tenant_id, staff_user_id) REFERENCES memberships (tenant_id, user_id),
  CHECK (ends_at > starts_at)
);
CREATE INDEX appointments_customer ON appointments (tenant_id, customer_id);
CREATE INDEX appointments_starts ON appointments (tenant_id, starts_at);
-- No double booking: the exclusion constraint in references/data-layer.md section 6
```

Phones are stored normalized, `0912345678` (normalizer: `references/data-import.md`). Policies for these tables: `references/postgres-rls.md` sections 2 and 3. Other tables join `customers` for names and phones instead of copying them, so a correction or deletion request reaches every screen and message.

## 3. Row Level Security: the DB-level safety net

Enable RLS on every tenant-owned table, with policies reading the current tenant from a transaction variable. Sample SQL, per-ORM context setup (pg, Prisma, Drizzle, TypeORM, Sequelize, GORM, ActiveRecord, SQLAlchemy, Django), Supabase, and the pitfall list are in `references/postgres-rls.md`. Read it before writing the project's first RLS migration.

Five things you must not get wrong:

- **The app connects as a regular role**: not superuser, not `BYPASSRLS`, not the table owner (or the table has `FORCE ROW LEVEL SECURITY`). Superusers bypass RLS, so tests run as superuser pass even when RLS doesn't work.
- **Set the tenant per transaction** (`set_config('app.tenant_id', $1, true)`), not per session. With a connection pool, a session-level setting leaks the previous request's tenant into the next request on the same connection.
- **No tenant context means no rows** (fail closed), not all rows.
- **Never add `OR ...` to a `FOR ALL` policy**: the `OR` branch opens update and delete too, not just read. `memberships` and `tenants`, which must be readable by user at login, get separate read and write policies (`references/postgres-rls.md` section 3).
- **The membership check filters on the current tenant** (`tenant_id = app_current_tenant()`), and `app.user_id` is set only in the login flow (`references/postgres-rls.md` section 4).

## 4. Outside the database

The tenant travels with the data everywhere:

- The server takes the tenant from the request path (`/v1/t/{tenantId}/...`) and checks on every request that the session user is a member (not a member → 404); never trust `tenant_id` in body/query (`references/api-conventions.md` section 5).
- Jobs / queues: the payload carries `tenant_id`; the worker sets tenant context before touching the DB. Cron lists tenants with `app_tenant_ids()` (a plain `SELECT FROM tenants` returns 0 rows under RLS) and handles each inside `withTenant` (`references/postgres-rls.md` section 3).
- Cache keys `t:{tenant_id}:...`; object storage keys `tenants/{tenant_id}/...`, built by one helper (`storageKey`, `references/app-security.md` section 2); search indexes, analytics and logs all have a `tenant_id` field.
- Admin/support needing cross-tenant views: a separate role and code path, with an audit log. Never "turn off RLS to save time".
- Noisy neighbors: per-tenant rate limits and quotas, `statement_timeout` on the app role.

## 5. Safe migrations

General rules (expand → migrate → contract, `lock_timeout`, `NOT NULL` and FKs on large tables, `CREATE INDEX CONCURRENTLY`, one migration author at a time): `references/data-layer.md` section 7. Two are specific to tenant tables:

- **Backfill on a `FORCE` table**: run as the owner role without tenant context and it updates 0 rows with no error; `pg_dump` as owner also fails. Run backfills/backups as a maintenance role with BYPASSRLS (or loop over tenants with `set_config`), and check the affected row count before the contract step (`references/postgres-rls.md` section 5). Skip this and dropping the old column also deletes the data that was never moved.
- **New tenant-owned table**: create the table, enable RLS, `FORCE`, policies, indexes and any REVOKE in the same migration, so the table never exists without RLS.

## 6. Tenant isolation tests

Mandatory for every endpoint touching tenant data. Create 2 tenants A and B with data. Log in as A and try to read / update / delete B's resources by id: must be 404. A's lists contain none of B's data. A `tenant_id` sent by the client is ignored. Test RLS directly in the DB as the app role; with no context, 0 rows. Test template (table-driven, covers new routes automatically) in `references/isolation-tests.md`.

## Reviewing an existing schema

Go through: which tenant-owned tables lack `tenant_id`? Which FKs aren't composite? Which unique constraints/indexes lack `tenant_id`? Is RLS enabled and `FORCE`d, and can the app role bypass it? Does any `FOR ALL` policy have an `OR` branch? Does the membership check filter on the current tenant? Is context set per session or per transaction? How do jobs list tenants? Can the app role change append-only tables? Which role runs backfills/backups? Do jobs, cache and storage carry the tenant? Are there isolation tests?

Report by severity: **Critical** (can leak data) → **Should fix** → **Suggestion**. Each item comes with a safe fix migration per section 5.
