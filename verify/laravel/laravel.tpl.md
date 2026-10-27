# Laravel: multi-tenant API on MySQL

The pack's rules (`references/multi-tenant.md` schema, `references/api-conventions.md`, `references/auth.md` section 4, `references/data-layer.md` section 6, `references/jobs.md`, `references/isolation-tests.md`) in Laravel. MySQL has no RLS: isolation lives in the data layer, composite keys and tests. MySQL itself (collations, DDL, locking reads, `sql_mode`): `references/mysql.md`.

Ran with Laravel 13.38.0 (skeleton 13.11.0), Sanctum 4.3.3, PHPUnit 12.5.42, PHP 8.3, on MySQL 8.4.13 and 8.0.46 from an empty database; section 8 on PostgreSQL 16. 67 tests; removing each safeguard failed one (section 7).

## Contents
1. Where things live
2. Tenant scope and its bypasses
3. Schema and connection
4. Eloquent: N+1, transactions, locks
5. No double booking
6. Reminder job on the database queue
7. Tests
8. Laravel on PostgreSQL with RLS

## 1. Where things live

| Concern | Where |
|---|---|
| `/v1/t/{tenant}/customers/{customer}` | `routes/api.php` (`apiPrefix: 'v1'`), middleware `auth:sanctum`, `tenant` |
| Tenant, membership (404), role | `app/Http/Middleware/ResolveTenant.php` |
| Input shape, phone normalization, camelCase → columns | FormRequests, no `unique:`/`exists:` (section 2) |
| `resource.action` permissions | `Gate::define($action, fn (User $user) => Permissions::can($this->app->make(TenantContext::class)->role(), $action))` per action (roles of `references/auth.md` section 4); staff book only for themselves: `AppointmentPolicy::create()` |
| `Gate::authorize()`, transactions, locks | `app/Services/*`, for HTTP, jobs and commands (`FormRequest::authorize()` is HTTP only) |
| Errors | `app/Support/ApiErrors.php`: 404 (incl. `ModelNotFoundException`), 403, 401, 400 `validation_failed`, 409 `customer_phone_taken` from `UniqueConstraintViolationException->index`, 422 `invalid_reference` from 1452 |

```php
{{app/Http/Middleware/ResolveTenant.php}}
```

`bootstrap/app.php`: `$middleware->alias(['tenant' => ResolveTenant::class])` and `$middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: ResolveTenant::class)`. Without the priority entry the `api` group's `SubstituteBindings` ran first and the isolation test got B's customer from A's path: 200.

## 2. Tenant scope and its bypasses

`app/Tenancy/TenantContext.php`: `set()`, `id()` (throws `MissingTenantContext` when empty), `role()`, `run($tenantId, fn)` (restores the previous value), `cacheKey()`, `storagePath()`. `AppServiceProvider` binds it `$this->app->scoped(TenantContext::class)` and calls `Model::shouldBeStrict(! $this->app->isProduction())`.

```php
{{app/Tenancy/BelongsToTenant.php}}
```

It covers Eloquent queries, relations, eager loads, route model binding. Bypasses, each shown by a test:

| Path | Result | Guard |
|---|---|---|
| `DB::table()`, `DB::select()`, `withoutGlobalScope('tenant')` | Other tenants' rows | `where('tenant_id', ...)` by hand; admin paths only |
| Model without the trait | Route binding returns B's row | The trait on every tenant model |
| `unique:customers,phone`, `Rule::unique(Customer::class)` | All tenants: B gets 422 for A's phone | `->where('tenant_id', ...)`, or the DB `UNIQUE` → 409 |
| `exists:customers,id` | Accepts B's id | `->where('tenant_id', ...)` or a scoped query |
| Queued job | No tenant; the request's doesn't travel | `tenantId` in the constructor, `run()` in `handle()` |
| Model as a job property | Restored with `newQueryWithoutScopes()` | Pass ids |
| Job that sets the tenant and leaves | A `singleton` context leaked into the next job | `scoped`, `run()` |
| Command, scheduler | The scope throws | Loop tenants, `run()` each |
| Cache keys, file paths | B got A's cached count | `cacheKey()`, `storagePath()` |

## 3. Schema and connection

`database/migrations/2026_10_27_000003_create_appointments.php` writes the keys of `references/multi-tenant.md` with the builder: `$table->primary(['tenant_id', 'id'])`, `$table->foreign(['tenant_id', 'customer_id'])->references(['tenant_id', 'id'])->on('customers')`, the same to `memberships (tenant_id, user_id)`, `$table->index(['tenant_id', 'staff_user_id', 'starts_at'], 'appointments_staff')`; CHECKs (`ends_at > starts_at AND ends_at <= starts_at + INTERVAL 12 HOUR`, status) need `DB::statement`.

- **Ids** `CHAR(36) ascii_bin` as in `references/mysql.md`: `asciiUuid()` is a `Blueprint` macro (`uuid($column)->charset('ascii')->collation('ascii_bin')`) on every uuid column, both sides of each FK (mismatch: 3780). 200,000 key lookups: 0.68 s, against 0.96 s in `utf8mb4_0900_ai_ci` and 1.18 s in `utf8mb4_unicode_ci`; size within 4%. An uppercase id in the path is a different id: 404.
- **Collation**: Laravel's config defaults to `utf8mb4_unicode_ci`, where `LIKE '%dang%'` misses "Đặng": set `utf8mb4_0900_ai_ci` (`references/mysql.md` section 3). Each connection sends `SET NAMES ... COLLATE`, `time_zone` (`'timezone' => '+00:00'`) and `sql_mode`.
- **`'strict' => false`** (a common fix for `ONLY_FULL_GROUP_BY`) sets `sql_mode` to `NO_ENGINE_SUBSTITUTION`: a 250-character name was cut to 200 without error (`references/mysql.md` section 7).
- **DDL** commits per statement and queues behind open transactions (`references/mysql.md` section 5). Laravel 13 writes the algorithm: `->instant()` → `algorithm=instant`; `$t->index('note')->inplace()->lock('none')` → `algorithm=inplace, lock=none`.
- No composite keys in Eloquent: models keep `id` (`HasUuids`, UUIDv7), `Membership` keys on `user_id`, the trait adds `tenant_id` to saves. Sanctum's migration uses `morphs()`: make `tokenable_id` an ascii uuid. Database notifications also want a table `notifications`. The skeleton's `phpunit.xml` uses SQLite: test on MySQL.

## 4. Eloquent: N+1, transactions, locks

| Tested | So |
|---|---|
| `shouldBeStrict()` throws on lazy loading only when the query returned 2+ rows | Seed 2+ rows. With `->with('customer')` the list ran 2 queries for 2 and 20 rows (3 and 21 without) |
| Strict mode throws `MassAssignmentException` for `tenant_id`; production drops it | Keep it out of `$fillable` |
| `save()` filters by `id` only: a full scan of `PRIMARY KEY (tenant_id, id)` | In a transaction it blocked tenant B's update (1205); the trait adds `tenant_id` |
| `DB::transaction()` in route middleware commits when the controller throws | Open transactions in the use case |
| `QueryException` messages hold bound values (phone, name), host, database | Map errors, never echo them |

## 5. No double booking

Lock the staff member's row, then check overlap, at READ COMMITTED (why: `references/mysql.md` section 6):

```php
{{app/Services/BookingService.php}}
```

10 PHP workers, requests sent at once (variants: the code edited by hand):

| Variant | 1 slot × 10 | 10 staff × 20 rounds |
|---|---|---|
| The code above | 1 × 201, 9 × 409 | new tenant: 200 × 201, every run |
| Same at REPEATABLE READ | 2–7 × 201: the customer check took the snapshot before the lock wait | |
| No staff lock | 5 × 201 | |
| REPEATABLE READ, `sharedLock()` + `forceIndex()` | 1 × 201 | new tenant: 3–6 × 500 (1213), all in round 1 (empty ranges share a gap); with `DB::transaction(..., attempts: 3)` 1–2 × 500 in 2 of 6 runs |
| Same on the `(tenant_id, starts_at)` plan, 3 days of history | | 79 × 500; `lockForUpdate()` 34–37 |
| REPEATABLE READ, `lockForUpdate()`, no lower bound | | 9–12 × 500 |
| No locks, 1-worker server | 1 × 201: sequential, proves nothing | |

`EXPLAIN` without the hint chose `PRIMARY` (the whole tenant) for a small tenant. `php -S` and `php artisan serve` run one request at a time unless `PHP_CLI_SERVER_WORKERS` > 1 (`serve` also needs `--no-reload`); `$this->postJson()` is sequential.

## 6. Reminder job on the database queue

`reminders:enqueue` (every 10 minutes, `withoutOverlapping()`) loops active tenants; inside `$tenant->run()`, per appointment 2–24 hours ahead, in one `DB::transaction()`: `Notification::createOrFirst(['appointment_id' => ..., 'kind' => 'reminder_24h'])` (`UNIQUE (tenant_id, appointment_id, kind)`), then `SendAppointmentReminder::dispatch($tenantId, $n->id)` if `wasRecentlyCreated`.

```php
{{app/Jobs/SendAppointmentReminder.php}}
```

- The database queue inserts the job in the open transaction: a rollback removed it. Redis, SQS: `afterCommit()` (lost if the process dies after commit) or an outbox.
- Workers claim with `FOR UPDATE SKIP LOCKED`; a job reserved past `retry_after` (90 s) goes to another worker.
- After 5 tries: `failed_jobs`, `failed()` ran, the row stays `pending`; `queue:retry` reruns it.

## 7. Tests

On MySQL, without `RefreshDatabase`: its transaction hides rows from the race test's server and refuses the booking's `SET TRANSACTION` (1568). Each test seeds its own tenants. `as()` calls `$this->app['auth']->forgetGuards()` first: the test app keeps the previous request's user.

```php
{{tests/Feature/CustomersIsolationTest.php}}
```

| Area | Expect |
|---|---|
| Isolation | A's list: A's rows only; B's list 404; `tenantId` in the body ignored; booking B's customer 422; malformed, unknown, uppercase, suspended tenant 404 |
| Race (`php -S` with 10 workers, `Http::pool()`) | section 5; `EXPLAIN` of `overlapping()`: `appointments_staff`, `PRIMARY` without the hint |
| Booking | overlap 409; touching, other staff, cancelled: 201; over 12 hours 400; inside a transaction 1568 |
| Customers | `+84 912 345 678` → `0912345678`; same phone 409 in the tenant, 201 in another; 400 with `details`; 25 rows at `limit=10`: 3 pages, no repeats; PATCH keeps other fields; no token 401 |
| Permissions | role × action matrix, unknown role denied; staff: customer write 403, booking for another staff 403; role from the path tenant |
| Schema | every `CHAR(36)` `ascii_bin`; `dang`, `thao` find "Đặng Thị Thảo"; B's customer or staff via `DB::table()`: 1452; CHECKs 3819; strict 1406 |
| Reminders | only the 10 h appointment of an active tenant (not 1 h, 30 h, cancelled, suspended); rerun adds none; one SMS `Chao Dang Thi Thao, nhac lich hen cua ban luc 17:00 02/11/2026.` (renamed after enqueue), key = notification id; redelivery: nothing; one failure: sent after 30 s; B's notification in A's job: nothing |

`$this->artisan()` needs `mockery/mockery`; `Artisan::call('queue:work', ...)` with `--stop-when-empty` runs the real worker loop in-process.

Removed, then failed: the priority entry (200), `scoped` (next job read A), READ COMMITTED (2 bookings), the staff lock (5), `forceIndex` (`PRIMARY`), `setKeysForSaveQuery`, `->with('customer')` (21 queries in production mode), `utf8mb4_0900_ai_ci`, `forgetGuards()`. With one server worker nothing failed: check the race test fails without the locks.

## 8. Laravel on PostgreSQL with RLS

Keep RLS as in `references/postgres-rls.md`. `App\Tenancy\PostgresTenant::run($tenantId, fn)` wraps the use case in `DB::connection('pgsql_app')->transaction()` whose first statement is `SELECT set_config('app.tenant_id', ?, true)`.

- Migrations run as the owner (`migrate --database=pgsql --path=database/migrations-pgsql`); RLS, `FORCE`, policies and grants are `DB::statement` calls in the migration creating the table.
- The app logs in as `app_user`. `server_options` on a `pgsql` connection adds `-c` options at connect (`statement_timeout`; the tests switch to `role=app_user`).
- As `app_user`: A sees only A's rows, no tenant sees 0 rows, inserting B's row fails (42501).
- **Session-level settings leak**: after a job ran `set_config(..., false)`, the worker's next job, which set nothing, counted A's rows. One connection serves every job of a `queue:work` process, every request of an Octane worker, and of an FPM worker with `PDO::ATTR_PERSISTENT`. With `set_config(..., true)` in the transaction the next job counted 0.
