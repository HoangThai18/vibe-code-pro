# Laravel: multi-tenant API on MySQL

The pack's rules (`references/multi-tenant.md` schema, `references/api-conventions.md`, `references/auth.md` section 4, `references/data-layer.md` section 6, `references/jobs.md`, `references/isolation-tests.md`) in Laravel. MySQL has no RLS: isolation lives in the data layer, the composite keys and the tests. MySQL-wide facts (collations, DDL locks, time zones, isolation levels): `references/mysql.md`.

Ran with Laravel 13.38.0 (skeleton 13.11.0), Sanctum 4.3.3, PHPUnit 12.5.42, PHP 8.3, on MySQL 8.4.13 and 8.0.46 from an empty database; section 8 on PostgreSQL 16. 59 tests; removing each safeguard failed one (section 7).

## Contents
1. Where things live
2. Tenant scope and its bypasses
3. Schema
4. Eloquent: N+1, transactions, locks
5. No double booking
6. Reminder job on the database queue
7. Tests
8. Laravel on PostgreSQL with RLS

## 1. Where things live

| Concern | Where |
|---|---|
| `/v1/t/{tenant}/customers/{customer}` | `routes/api.php` (`apiPrefix: 'v1'`), middleware `auth:sanctum` then `tenant` |
| Tenant from the path, membership (404), role | `app/Http/Middleware/ResolveTenant.php` |
| Input shape, phone normalization, camelCase → columns | FormRequests, without `unique:`/`exists:` (section 2) |
| `resource.action` permissions | `Permissions::can($role, $action)` (roles of `references/auth.md` section 4), one Gate per action: `Gate::define($action, fn (User $user) => Permissions::can($this->app->make(TenantContext::class)->role(), $action))`; staff book only for themselves: `AppointmentPolicy::create()` |
| Use cases: `Gate::authorize()`, transactions, locks | `app/Services/*`, for HTTP, jobs and commands alike (`FormRequest::authorize()` runs for HTTP only) |
| Error body | `app/Support/ApiErrors.php`: 404 `not_found` (incl. `ModelNotFoundException`), 403, 401, 400 `validation_failed` with `details`, 409 `customer_phone_taken` from `UniqueConstraintViolationException->index`, 422 `invalid_reference` from MySQL 1452 |

```php
{{app/Http/Middleware/ResolveTenant.php}}
```

`bootstrap/app.php` registers it with `$middleware->alias(['tenant' => ResolveTenant::class])` and `$middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: ResolveTenant::class)`. Without the priority entry, the `api` group's `SubstituteBindings` ran first (route middleware outside the priority list keeps its place) and the isolation test got B's customer from A's path: 200.

## 2. Tenant scope and its bypasses

`app/Tenancy/TenantContext.php` holds tenant id and role: `set()`, `id()` (throws `MissingTenantContext` when empty: fail closed), `role()`, `run($tenantId, fn)` (restores the previous value), `cacheKey()`, `storagePath()`. `AppServiceProvider` binds it `$this->app->scoped(TenantContext::class)` and calls `Model::shouldBeStrict(! $this->app->isProduction())`.

```php
{{app/Tenancy/BelongsToTenant.php}}
```

The scope covers Eloquent queries, relations, eager loads, route model binding. The bypasses, each shown by a test:

| Path | Result | Guard |
|---|---|---|
| `DB::table()`, `DB::select()`, `withoutGlobalScope('tenant')` | Other tenants' rows | `where('tenant_id', ...)` by hand; admin paths only |
| Model without the trait | Route binding returns B's row in A's path | The trait on every tenant model |
| `unique:customers,phone`, `Rule::unique(Customer::class)` | All tenants: B gets 422 for A's phone (a leak) | `Rule::unique('customers', 'phone')->where('tenant_id', ...)`, or the DB `UNIQUE` → 409 |
| `exists:customers,id` | Accepts B's id | `->where('tenant_id', ...)`, or a scoped query |
| Queued job | No tenant; the dispatching request's doesn't travel | `tenantId` in the constructor, `run()` in `handle()` |
| Model as a job property | Restored with `newQueryWithoutScopes()` | Pass ids |
| Job that sets the tenant and leaves | With a `singleton` context the worker's next job read it | `scoped`, `run()` |
| Command, scheduler | The scope throws | Loop tenants, `run()` each (section 6) |
| Cache keys, file paths | `Cache::remember('customer_count')`: B got A's number | `cacheKey()`, `storagePath()` |

## 3. Schema

```php
{{database/migrations/2026_10_27_000003_create_appointments.php}}
```

- `customers`: `$table->primary(['tenant_id', 'id'])`, `$table->unique(['tenant_id', 'phone'])`. The builder writes composite keys and FKs as in `references/multi-tenant.md` (checked with `SHOW CREATE TABLE`); CHECKs need `DB::statement` (MySQL error 3819).
- Eloquent has no composite keys: models keep `id` (`HasUuids`, UUIDv7 in Laravel 13), `Membership` keys on `user_id`, the trait adds `tenant_id` to saves.
- `$table->uuid()` is `CHAR(36)` in the table collation (`utf8mb4_unicode_ci` in Laravel's config). Changing it (`references/mysql.md`): change both sides of every FK, mismatches fail with 3780.
- Sanctum's migration uses `morphs()`: with uuid users, `uuidMorphs('tokenable')`. Laravel's database notifications also want a table `notifications`.
- The skeleton's `phpunit.xml` uses SQLite `:memory:`, where locks, FKs, CHECKs and collations differ: test on MySQL.

## 4. Eloquent: N+1, transactions, locks

| Tested | So |
|---|---|
| `shouldBeStrict()` throws on lazy loading only for models of a query that returned 2+ rows | Seed 2+ rows; with `->with('customer')` the list ran the same queries for 2 and 20 |
| Strict mode throws `MassAssignmentException` for `tenant_id` in `create()`; production drops it | Keep `tenant_id` out of `$fillable` |
| `save()` filters by `id` only: with `PRIMARY KEY (tenant_id, id)` a full key scan (`EXPLAIN` type `index`) | In a transaction it blocked tenant B's update until timeout (1205): the trait adds `tenant_id` |
| `DB::transaction()` in route middleware commits when the controller throws (the error reaches it as a response) | Open transactions in the use case |
| `QueryException` messages hold the SQL with bound values (a phone, a name) and the host and database | Map errors (section 1), never echo them |

## 5. No double booking

No exclusion constraint on MySQL: lock the staff member's membership row, then check overlap with a locking read.

```php
{{app/Services/BookingService.php}}
```

Ten overlapping bookings for one staff member (03:00–04:00, 03:03–04:03...) sent at once to ten PHP workers (variants: the code edited by hand):

| Variant | Result |
|---|---|
| The code above | 1 × 201, 9 × 409 `appointment_slot_taken` |
| No locks (check, then insert) | 4 × 201 |
| Staff lock, plain `exists()` | 7 × 201: the customer check took the REPEATABLE READ snapshot before the lock wait |
| `FOR UPDATE` on the overlap only | 1 × 201, 6 × 409, 3 × 500: gap-lock deadlocks (1213) |
| No locks, 1-worker server | 1 × 201, 9 × 409: one request at a time, the test proved nothing |

`php -S` and `php artisan serve` run one request at a time unless `PHP_CLI_SERVER_WORKERS` > 1 (`artisan serve` also needs `--no-reload`, or it warns and starts one). The test client (`$this->postJson()`) is sequential.

## 6. Reminder job on the database queue

`reminders:enqueue` (every 10 minutes, `withoutOverlapping()`) loops the active tenants (a global table); inside `$tenant->run()` it takes appointments 2–24 hours ahead and, per appointment in one `DB::transaction()`, calls `Notification::createOrFirst(['appointment_id' => ..., 'kind' => 'reminder_24h'])` (insert first: `UNIQUE (tenant_id, appointment_id, kind)` stops a second run) and, if `wasRecentlyCreated`, `SendAppointmentReminder::dispatch($tenantId, $n->id)`.

```php
{{app/Jobs/SendAppointmentReminder.php}}
```

- The database queue inserts the job on the same connection, in the transaction: a rollback removed it. Redis and SQS are outside it: `afterCommit()` (lost if the process dies right after commit) or an outbox.
- MySQL 8 workers claim with `FOR UPDATE SKIP LOCKED`. A job reserved longer than `retry_after` (90 s in `config/queue.php`) goes to another worker: `$timeout` below it.
- After 5 tries: `failed_jobs`, `failed()` ran, the row stays `pending`; `queue:retry` reruns it. `withoutOverlapping()` locks in the cache: a shared store in production.

## 7. Tests

On MySQL, without `RefreshDatabase`: its per-test transaction hides rows from the race test's server and from a second connection. Each test seeds its own tenants. `member()` creates tenant, user, membership and a Sanctum token; `as()` first calls `$this->app['auth']->forgetGuards()`, since the test app keeps the previous request's user (without it, requests "as A" ran as B).

```php
{{tests/Feature/CustomersIsolationTest.php}}
```

```php
{{tests/Feature/BookingRaceTest.php}}
```

`TestServer::start()` runs `php -S` on `public/index.php` with `PHP_CLI_SERVER_WORKERS` and waits for `/up`. Other cases:

| Area | Expect |
|---|---|
| Isolation | A's list: A's rows only; B's list 404; `tenantId` in the body ignored; booking with B's customer 422; malformed, unknown, suspended tenant 404 |
| Customers | `+84 912 345 678` → `0912345678`; same phone: 409 in the tenant, 201 in another; 400 with `details`; 25 rows at `limit=10`: 3 pages, no repeats; PATCH keeps other fields; no token 401 |
| Permissions | role × action matrix, unknown role denied; staff: customer write 403, booking for another staff 403; role from the path tenant |
| Schema | B's customer or staff in A's appointment via `DB::table()`: 1452; CHECKs: 3819 |
| Reminders | only the 10 h appointment of an active tenant (not 1 h, 30 h, cancelled, suspended); rerun adds none; one SMS `Chao Dang Thi Thao, nhac lich hen cua ban luc 17:00 02/11/2026.` (renamed after enqueue), key = notification id; redelivery sends nothing; one failure: sent after the 30 s backoff; B's notification in A's job: nothing |

`$this->artisan()` needs `mockery/mockery` (a skeleton dev dependency; this project uses `Artisan::call()`). `queue:work --stop-when-empty` through `Artisan::call()` runs the real worker loop in-process.

Removed, then failed: the priority entry (isolation: 200), `scoped` (queue: the next job read tenant A), the staff lock (race: 3 × 500), the locking overlap read (race: 7 bookings), `setKeysForSaveQuery` (UPDATE without `tenant_id`), `forgetGuards()` (wrong user). With one server worker nothing failed: make sure the race test fails without the locks.

## 8. Laravel on PostgreSQL with RLS

Keep RLS as in `references/postgres-rls.md`; one transaction per request or job, tenant first:

```php
{{app/Tenancy/PostgresTenant.php}}
```

- Migrations run as the owner on their own connection (`migrate --database=pgsql --path=database/migrations-pgsql`); `ENABLE`/`FORCE ROW LEVEL SECURITY`, policies and grants are `DB::statement` calls in the migration that creates the table.
- The app logs in as `app_user`. A `pgsql` connection's `server_options` adds libpq `-c` options at connect (`statement_timeout`; the tests switch the superuser to `role=app_user`).
- As `app_user`: A sees only A's rows, no tenant sees 0 rows, inserting B's row fails with 42501.
- **Session-level settings leak**: a job ran `set_config('app.tenant_id', ..., false)` and the worker's next job, which set nothing, counted A's rows. One connection serves every job of a `queue:work` process, every request of an Octane worker, and every request of an FPM worker with `PDO::ATTR_PERSISTENT`. With `set_config(..., true)` in `DB::transaction()` the next job counted 0.
