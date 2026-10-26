# Data layer: schema, indexes, transactions, migrations, file storage

Examples use PostgreSQL; the principles apply to MySQL/SQL Server with equivalent syntax. Multi-tenancy: see `references/multi-tenant.md`.

## Contents
1. Data types
2. Constraints and relations
3. Standard columns, soft delete, history
4. Indexes
5. Queries and pagination
6. Transactions and contention
7. Safe migrations
8. Files and object storage

## 1. Data types

| Data | Use | Avoid |
|---|---|---|
| ID | `uuid` (`uuidv7()` built in from Postgres 18; older versions use `gen_random_uuid()` or generate UUIDv7 in the app) or `bigint generated always as identity` for internal tables | exposing auto-increment IDs in the API |
| Money | `bigint` in the smallest unit + a currency code column, or `numeric(15,2)` for money with decimals | `float`, `real`, `double` |
| Point in time | `timestamptz` (stored as UTC) | `timestamp` without time zone for real instants |
| Plain date (birthday, holiday) | `date` | a midnight timestamp |
| String | `text` + length CHECK if needed | `varchar(255)` out of habit |
| Status | `text` + CHECK (fixed values that change with code) or a lookup table (when admins need to add values) | integers "1, 2, 3" nobody remembers |
| Flexible data | `jsonb` for custom attributes, webhook payloads | `jsonb` for data you filter, join or constrain often |
| Phone numbers, codes | `text` (keeps leading 0 and +) | numeric types |

## 2. Constraints and relations

- `NOT NULL` is the default; a nullable column needs a business reason.
- Every FK states `ON DELETE` (`RESTRICT` is the safe default; `CASCADE` only for data wholly owned by the parent, e.g. order lines).
- `UNIQUE` for everything the business treats as unique (email within an organization, order code). Without UNIQUE, two concurrent requests create a duplicate even if the code "checks before insert".
- `CHECK` for value ranges and states (`amount >= 0`, `status IN (...)`, `end_at > start_at`).
- Many-to-many goes through a join table with a composite primary key and the relation's own columns (role, joined date).

## 3. Standard columns, soft delete, history

- `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at` (updated by trigger or ORM).
- **Soft delete** (`deleted_at`) has a cost: every query must remember to filter, and UNIQUE becomes a partial index (`... WHERE deleted_at IS NULL`). An `archived` status is often clearer. Personal data a customer asks to delete must be really deleted or anonymized.
- **Change history** (who changed what, when) for sensitive data: an `audit_log` table (actor, action, entity, entity_id, diff jsonb, at) written in the same transaction.

## 4. Indexes

- Index every FK column and every column real queries filter or sort by.
- Multi-column index: equality (`=`) columns first, range or sort columns after, e.g. `(tenant_id, status, created_at DESC)`.
- Partial index for a frequently queried subset (`WHERE status = 'pending'`), unique partial index for soft delete.
- Verify with `EXPLAIN (ANALYZE, BUFFERS)` on enough data; don't guess. Every index slows writes, so drop indexes no query uses.

## 5. Queries and pagination

- No `SELECT *` in product code: select the columns you use.
- **N+1** (a query inside a loop) is the most common ORM performance bug; per-ORM fixes in `references/orm.md`.
- Cursor (keyset) pagination: `WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT 20`, with index `(created_at DESC, id DESC)`. Large offsets are slow and duplicate or skip rows when data changes between pages. Cursor values must keep the DB's precision: `timestamptz` has microseconds, JavaScript `Date` only milliseconds, so take the value as text from the DB (e.g. `created_at::text`) or use an increasing id column as the sort key; otherwise rows are duplicated or skipped between pages.
- Bulk operations: batch (500–5000 rows), never one statement updating a million rows.

## 6. Transactions and contention

- One transaction wraps exactly one business unit (create order + decrement stock + write audit), as short as possible.
- Contended resources (appointment slots, stock, balances): use DB constraints (UNIQUE, CHECK `stock >= 0`), or `SELECT ... FOR UPDATE`, or a conditional update (`UPDATE ... SET stock = stock - 1 WHERE id = $1 AND stock > 0`, then check the affected row count).
- Several people editing the same record (edit forms): optimistic locking with a `version` column, updating with `WHERE version = $old`.
- External side effects (email, payment gateway, webhooks): write to an outbox table in the same transaction and let a worker send later; or call after commit with an idempotency key.
- Deadlocks: always lock rows in the same order (e.g. ascending id).

## 7. Safe migrations

- **Expand → migrate → contract**: add the new column/table (backward compatible) → deploy code that writes both → backfill in batches → switch reads to the new one and drop `NOT NULL` on the old column → stop writing and remove the old column from the ORM model → drop the old column in a separate, final release. Renaming a column "in one go" breaks the running code the moment you deploy. Step table with rollback options: the `vibe-ship` skill (`references/release-rollback.md`, section 2).
- Start migrations with `SET lock_timeout = '5s'`: an ALTER waiting for a lock blocks every query queued behind it, so failing early and rerunning is safer.
- `CREATE INDEX CONCURRENTLY` for large tables (cannot run inside a transaction; disable the tool's transaction for that migration).
- New FK or CHECK on a table with data: `NOT VALID`, then `VALIDATE CONSTRAINT` in a separate step. `NOT NULL`: CHECK `NOT VALID` → `VALIDATE` → `SET NOT NULL` → drop the helper CHECK.
- Backfill: in batches, rerunnable (idempotent), check affected row counts. If the table has RLS `FORCE`, read `references/postgres-rls.md` section 5 first: the backfill can silently update 0 rows.
- Never edit a migration that ran in a shared environment; write a new one.
- Only one task creates migrations at a time, so their order doesn't collide.

## 8. Files and object storage

- Files (images, PDFs, documents) go to object storage (S3, R2, GCS, Supabase Storage); the DB stores only metadata: key, original name, MIME, size, checksum, uploader, `tenant_id`.
- Upload straight from the browser with a short-lived **presigned URL** limited in size and file type; the server creates the URL after checking permissions.
- The server generates the key (`tenants/{tenant_id}/customers/{id}/{uuid}.pdf`); never use the user's file name.
- Buckets are private by default; download via presigned GET after a permission check. Public files (product images) go in a separate bucket or prefix.
- Check the real file type (magic bytes); virus-scan files users share with each other; never serve uploads as HTML on the app's domain.
- Deleting a record triggers a job that cleans up its files; enable versioning for important data.
