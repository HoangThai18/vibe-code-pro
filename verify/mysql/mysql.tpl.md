# MySQL: the multi-tenant SaaS on MySQL instead of PostgreSQL

The other references are written for PostgreSQL. This one lists what replaces RLS, exclusion constraints, `timestamptz`, transactional DDL and `unaccent` on MySQL. Ran with Node 22, mysql2 3.24.6, `node:test`, on MySQL 8.4.13 (official `mysql:8.4` image) and 8.0.46 (Ubuntu 24.04): 61 tests from an empty database, as an app user with DML grants only.

**Versions.** 8.0 reached end of life on 2026-04-30. 8.4 is LTS (premier support to 2029-04, extended to 2032-04); 9.7 (2026-04) is the newest LTS, not tested here.

## Contents
1. What changes
2. Tenant isolation without RLS
3. Vietnamese text
4. Time and money
5. Migrations
6. Concurrency: double booking, deadlocks, job queue
7. Session settings and sql_mode
8. Tests
9. MariaDB

## 1. What changes

| PostgreSQL reference | MySQL |
|---|---|
| RLS + `FORCE`, `set_config(..., true)` | Nothing in the database: every query filters `tenant_id` |
| Workers list tenants with `app_tenant_ids()` | `SELECT id FROM tenants WHERE status = 'active'` |
| `timestamptz` | `DATETIME(3)` holding UTC |
| `pg_trgm` + `unaccent` | The column collation `utf8mb4_0900_ai_ci` |
| Transactional DDL, `CONCURRENTLY`, `lock_timeout` | Each DDL statement commits; `ALGORITHM`/`LOCK`; `lock_wait_timeout` |
| Exclusion constraint | Lock the staff member's row |
| `RETURNING` | None (`1064`): generate ids in the app |
| An error aborts the transaction | Only the failed statement is undone; `COMMIT` keeps the rest |
| pg-boss | A `jobs` table claimed with `SKIP LOCKED` |
| `23505`, `23503`, `23P01` | `1062`; `1452`, or `1216` on 8.0 for a user with database-level grants; none |

## 2. Tenant isolation without RLS

One query without `tenant_id` leaks data, and nothing stops it. What remains:

1. **Every statement filters `tenant_id`.** `withMember` is the one of `references/postgres-rls.md` section 4 without `set_config`: it checks the membership with `m.tenant_id = ?` (else 404) and hands repositories `TenantDb { conn, tenantId }`, never a bare connection. A test fails on any SQL string in the source that touches a tenant table without `tenant_id`.
2. **Composite FKs** reject the cross-tenant reference the code forgot. InnoDB (tested): the referenced columns must be a whole primary or `UNIQUE` key (8.4 refuses a prefix, `6125`; 8.0 accepted it); type, charset and collation must match (`3780`); a column-level `REFERENCES` is silently ignored; the child index is added for you.
3. **Uniques include `tenant_id`.**
4. **The app user has DML only** (`ALTER`: `1142`). A grant on `db.*` cannot be narrowed (`REVOKE UPDATE ON db.audit_log`: `1147`): grant append-only tables one by one.

```sql
{{migrations/002_customers_appointments.sql}}
```

**A view filtered by a session variable is no substitute.** A view cannot read `@tenant_id` (`1351`); through a function it can, but MySQL has no transaction-scoped setting, so the value stays on the pooled connection. Tested: the request after tenant A's, on the same connection and on a path without the `SET`, read A's customers through the view, and the base table stayed readable. mysql2's `resetOnRelease: true` clears it, with every setting made on connect (`time_zone`).

**Database per tenant** pays off when the server must enforce the boundary (contract, regulator) or a few large tenants need their own backup, restore, region or capacity. It costs a migration run per tenant, a pool or `USE` per tenant (session state again), cross-tenant reports elsewhere, thousands of tables. Hybrids work (`references/multi-tenant.md` section 1).

## 3. Vietnamese text

- **utf8mb4.** `utf8` still means `utf8mb3`: `'Cảm ơn 🙏'` fails (`1366`). Create the database `CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`, ids `ascii_bin`; a test checks every column.
- **Connection.** mysql2 defaults to `utf8mb4_unicode_ci`: set `charset: 'utf8mb4_0900_ai_ci'` (section 7).
- **NFC.** MySQL cannot check it, and a decomposed name (macOS, iOS) matches `=` but not `LIKE '%phuong%'`: normalize when writing.

| Collation | Nguyễn = nguyen | Đặng = dang | Nguyễn = nguyên | Ðông (U+00D0) = dong | Order |
|---|---|---|---|---|---|
| `utf8mb4_0900_ai_ci` (8.x default) | 1 | 1 | 1 | 1 | Ă, Â with A; Đ with D |
| `utf8mb4_vi_0900_ai_ci` | 0 | 0 | 1 | 0 | Vietnamese: A Ă Â, D Đ, O Ô Ơ, U Ư |
| `utf8mb4_unicode_ci` | 1 | 0 | 1 | 0 | Đ after D |
| `utf8mb4_general_ci` | 1 | 0 | 1 | 0 | Đ after Z |

The Vietnamese collation ignores only tones (ê, ơ, ư, ă, â, đ are letters), so a column in it never finds "Nguyễn" from `nguyen`. Search on `utf8mb4_0900_ai_ci`; order a page of results with `Intl.Collator('vi')`, long lists with an indexed `VIRTUAL` column `COLLATE utf8mb4_vi_0900_ai_ci`. An accent-insensitive `UNIQUE` treats "Gội đầu" and "Gói đầu" as one value: such keys get `utf8mb4_0900_as_cs`.

The tested search: one `full_name LIKE ?` per word, `%` `_` `\` escaped; digits search `phone`; `ORDER BY full_name LIMIT 20` walks the `(tenant_id, full_name)` index and stops at 20 matches; the app then sorts the page, accent-exact matches first. On 8.4.13, 220,000 customers (41% Nguyễn), median of 15 warm runs:

| Query | Tenant of 200,000 | of 20,000 |
|---|---|---|
| `'tran thi th%'`; `'%thao%'`; `'%dang%' AND '%anh%'` | 1.2–1.9 ms | 0.7–1.1 ms |
| `'%nguyen%'` / `'%xyz%'` (no match: the whole tenant) | 17 / 53 ms | 5 ms (xyz) |
| Same, sorted `COLLATE utf8mb4_vi_0900_ai_ci` in SQL | 60–91 ms | |
| FULLTEXT ngram `+"thao" +"nguyen"` (one index for all tenants) | 1,150 ms | 1,130 ms |
| Whole list in Vietnamese order: `COLLATE` / indexed `VIRTUAL` column | 61 / 1.0 ms | |
| Phone prefix / `'%345678%'` / suffix via indexed `REVERSE(phone)` | 1.2 / 30 / 1.0 ms | |

Adding FULLTEXT also takes `LOCK=SHARED` and costs the table `INSTANT ADD COLUMN` (section 5). Typo tolerance: a search engine (`references/search.md` section 7).

## 4. Time and money

| Topic | Use | Tested |
|---|---|---|
| Instants | `DATETIME(3)` in UTC, `DEFAULT (UTC_TIMESTAMP(3))`; round-trips a JS `Date` | `DEFAULT CURRENT_TIMESTAMP(3)` follows the session zone: 7 h off from a `+07:00` session |
| `TIMESTAMP` | avoid | converts with the session zone; ends 2038-01-19 03:14:07 UTC (`1292`) |
| mysql2 `timezone` | `'Z'` | default `'local'` under `TZ=Asia/Ho_Chi_Minh` wrote 03:00Z as `10:00`; it never sets the session zone |
| Named zones | need `mysql.time_zone_name` | empty on Ubuntu's 8.0.46: `CONVERT_TZ(..., 'Asia/Ho_Chi_Minh')` is `NULL`, no error; `SET time_zone` to it: `1298`. The official image loads 1,795 zones. Check managed servers |
| "Today" for the tenant | the day's UTC boundaries from `Intl.DateTimeFormat` in the app (offset taken twice, for DST), then `starts_at >= ? AND starts_at < ?` | `key_len` 43, both index columns; `CONVERT_TZ(starts_at, ...)` leaves 36. A New York DST day: 25 h |
| Money | `BIGINT` VND or `DECIMAL(15,2)` | mysql2 returns `SUM(bigint)` and `DECIMAL` as strings (`'124956789'`); `FLOAT` stored 123456789 as 123456792 |

## 5. Migrations

**DDL commits.** `BEGIN`, `CREATE TABLE`, `INSERT`, a failing `CREATE TABLE`, `ROLLBACK`: the table and the row stay. No `ADD COLUMN IF NOT EXISTS` (`1064`). The tested runner records each statement once it ran and resumes after the last one; an edited recorded statement stops it.

| Change (8.4.13 and 8.0.46 alike) | Best |
|---|---|
| Add column (nullable, `NOT NULL DEFAULT`, `AFTER x`), drop/rename column, set default, append `ENUM` value, add `VIRTUAL` column | `INSTANT` |
| Add/drop/rename index; widen `VARCHAR` within 255 bytes; `NULL` → `NOT NULL`; FK with `foreign_key_checks = 0` | `INPLACE, LOCK=NONE` |
| FULLTEXT index | `INPLACE, LOCK=SHARED` (no writes) |
| `INT` → `BIGINT`; utf8mb4 `VARCHAR(60)` → `(70)` (past 255 bytes); `STORED` column; `CHECK`; FK with checks on | `COPY, LOCK=SHARED` (no writes) |

On 220,000 rows: `INSTANT` 0.01 s, an index 0.8 s, `ADD COLUMN` + `ADD INDEX` in one `ALTER` 3.5 s (full rebuild), `INT` → `BIGINT` 5.7 s.

- **Write `ALGORITHM=` every time.** After 64 instant changes INSTANT fails (`4092`); without the clause MySQL silently rebuilds.
- **One change per statement.** `ADD COLUMN` + `ADD INDEX` cannot be `INSTANT`, and `INPLACE` rebuilds the table (new `TABLE_ID`). A `VIRTUAL` column plus its index refuses `LOCK=NONE` (`1846`).
- **A FULLTEXT index, even dropped,** blocks `INSTANT ADD COLUMN` (`1845`) until a rebuild.

**The metadata lock queue.** Every `ALTER`, `INSTANT` included, needs an exclusive metadata lock, and an open transaction holds a shared one on every table it touched until it ends, idle or not. Tested: a transaction read one row and stayed open; the `ALTER` waited; three new plain `SELECT`s queued behind the `ALTER` (`Waiting for table metadata lock`) until the transaction ended. `lock_wait_timeout` defaults to one year; at 1 s the `ALTER` failed (`1205`) and the reads ran at once. The runner, before each statement:

1. Refuses while a transaction is old: `sys.x$processlist` with `trx_state = 'ACTIVE'` and a large `trx_latency` (picoseconds). Not `innodb_trx.trx_started`: it ignores the session zone (7 h off from `+07:00`).
2. Sets `lock_wait_timeout = 5`; on `1205`, retry later. Stuck: `sys.schema_table_lock_waits` gives `blocking_pid` and `sql_kill_blocking_connection`.

**gh-ost, pt-online-schema-change** copy the table and swap it in, for `COPY`-only changes on large busy tables. gh-ost (binlog-based; CI covers MySQL 5.7–8.4) does not support foreign keys, so not these tables. pt-online-schema-change (Percona Toolkit 3.7.2, 2026-10-22, MySQL 9.7 support) uses triggers and `--alter-foreign-keys-method` (`rebuild_constraints` renames the FKs; `drop_swap` drops the table for a moment). Both take metadata locks too. Neither was run here.

## 6. Concurrency: double booking, deadlocks, job queue

Under REPEATABLE READ (the default) a plain `SELECT` reads the snapshot of the transaction's first read; a locking read (`FOR UPDATE`, `FOR SHARE`) reads the latest rows and locks every index entry its plan scans, gaps included. Bookings serialize on the staff member's row:

```ts
{{src/appointments.ts}}
```

| Guard (tested) | Result |
|---|---|
| Plain `SELECT` check, then `INSERT` | double booking |
| `FOR UPDATE` on the overlap check only | both get the gap lock and the inserts deadlock (`1213`) when the window ends the index; else the second waits |
| Staff lock + plain `SELECT` | double booking at REPEATABLE READ (the snapshot predates the wait); holds at READ COMMITTED |
| Staff lock + `FOR SHARE` on the optimizer's `(tenant_id, starts_at)` plan | 10 staff at the same hour × 20: 176–178 of 200 deadlocked, both versions |
| The code above | one slot × 10 requests (no retry, and through `withMember`): 1 booked, 9 × 409 `appointment_slot_taken`; 10 staff at once: 0 deadlocks |
| Fixed slots: `appointment_slots` with `PRIMARY KEY (tenant_id, staff_user_id, slot_start)`, a row per 30 minutes | 1 booked, 9 × `1062` → 409 |

`withMember` reruns the whole transaction on `1213` (`retryOnDeadlock`). Jobs go into a `jobs` table in the business transaction; a worker claims in a short transaction, `SELECT ... FROM jobs FORCE INDEX (jobs_ready) WHERE queue = ? AND status = 'queued' AND run_at <= UTC_TIMESTAMP(3) ORDER BY run_at LIMIT ? FOR UPDATE SKIP LOCKED`, marks the rows `running` with a lease, commits, then works. Pin the index: on a small table the optimizer's full scan locked every queued row and a second worker claimed nothing, index present or not (at READ COMMITTED too). The reminder job follows `references/jobs.md`: a plain tenant loop, one `notifications` row per appointment (`UNIQUE`, `1062` skipped), backoff, dead after 5 attempts, expired leases requeued.

## 7. Session settings and sql_mode

| Setting | Tested |
|---|---|
| Pool: `charset: 'utf8mb4_0900_ai_ci'`, `timezone: 'Z'`, `SET time_zone = '+00:00'` per new connection; `checkSession` at startup | refuses to start without strict mode or UTC |
| Strict `sql_mode` + `ONLY_FULL_GROUP_BY` (8.x default) | with `''`: `'Nguyễn Thị Thảo'` → `'Nguyễ'` in `VARCHAR(5)`, `'abc'` → 0, `'2026-02-30'` → `0000-00-00`, warnings only; `GROUP BY` returned any `name`. Strict: `1406`, `1366`, `1292`, `1055` |
| `INSERT IGNORE` | truncates even when strict, turns FK failures into warnings: catch `1062` instead |
| `affectedRows` | mysql2 sets `CLIENT_FOUND_ROWS`: an `UPDATE` changing nothing counts its row (no false 404); an `ON DUPLICATE KEY UPDATE` no-op counts 1, like an insert |
| Keyset pagination | `created_at < ? OR (created_at = ? AND id < ?)`; `(created_at, id) < (?, ?)` is not an index range |

## 8. Tests

As the DML-only app user on a real MySQL (CI: a `mysql:8.4` service): the matrix of `references/isolation-tests.md` (both paths, lists, client `tenantId`, cross-tenant booking: 422), the cases above, and:

| Case | Expect |
|---|---|
| SQL strings in the source on tenant tables | all mention `tenant_id` |
| `thao nguyen`, `ĐẶNG  ánh`, `ánh`, NFD `Phượng`, `+84 912 345 678`, `345678`, `%%` | the right customers, Vietnamese order, accent-exact first; `%%` nothing |
| Runner behind a young / an old open transaction | `1205` within 3 s / refuses to start |
| Pooled `@tenant_id`; `resetOnRelease` | leaks to the next request; cleared, `time_zone` reset |

Each of these was removed once and a test failed: the `tenant_id` filter, the composite FK, `tenant_id` in the phone unique, the staff lock, `FOR SHARE`, both `FORCE INDEX`, `SKIP LOCKED`, `lock_wait_timeout`, the long-transaction check, `timezone: 'Z'`, NFC, `LIKE` escaping.

## 9. MariaDB

Not run here; check each on your version: no `utf8mb4_0900_ai_ci` or `utf8mb4_vi_0900_ai_ci` (rerun section 3's table with its collations); `INSERT ... RETURNING` and `ADD COLUMN IF NOT EXISTS` exist; `SKIP LOCKED` only in newer releases; different `INSTANT` rules; no `sys` schema by default; `JSON` is `LONGTEXT`. gh-ost's CI covers MariaDB 10.5–11.8. Run section 8's tests there first.
