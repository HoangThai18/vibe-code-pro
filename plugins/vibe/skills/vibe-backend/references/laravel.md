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
<?php
// app/Http/Middleware/ResolveTenant.php

namespace App\Http\Middleware;

use App\Models\Membership;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

// /v1/t/{tenant}/...: the tenant comes from the path, the role from the membership. Runs after auth:sanctum
// and before SubstituteBindings (bootstrap/app.php), so {customer} is resolved inside the tenant scope.
final class ResolveTenant
{
    public function __construct(private TenantContext $tenant) {}

    public function handle(Request $request, Closure $next): Response
    {
        $tenantId = (string) $request->route('tenant');
        $request->route()->forgetParameter('tenant');   // controllers receive only their own parameters
        if (! Str::isUuid($tenantId)) {
            throw new NotFoundHttpException;             // malformed id: 404
        }

        $this->tenant->set($tenantId);
        // Through the tenant scope: only this tenant's membership rows, and only an active tenant
        $role = Membership::query()
            ->where('user_id', $request->user()->getAuthIdentifier())
            ->whereHas('tenant', fn ($q) => $q->where('status', 'active'))
            ->value('role');
        if ($role === null) {
            $this->tenant->clear();
            throw new NotFoundHttpException;             // not a member: 404, don't reveal that the tenant exists
        }
        $this->tenant->set($tenantId, $role);

        return $next($request);
    }
}
```

`bootstrap/app.php` registers it with `$middleware->alias(['tenant' => ResolveTenant::class])` and `$middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: ResolveTenant::class)`. Without the priority entry, the `api` group's `SubstituteBindings` ran first (route middleware outside the priority list keeps its place) and the isolation test got B's customer from A's path: 200.

## 2. Tenant scope and its bypasses

`app/Tenancy/TenantContext.php` holds tenant id and role: `set()`, `id()` (throws `MissingTenantContext` when empty: fail closed), `role()`, `run($tenantId, fn)` (restores the previous value), `cacheKey()`, `storagePath()`. `AppServiceProvider` binds it `$this->app->scoped(TenantContext::class)` and calls `Model::shouldBeStrict(! $this->app->isProduction())`.

```php
<?php
// app/Tenancy/BelongsToTenant.php

namespace App\Tenancy;

use Illuminate\Database\Eloquent\Builder;

// Every model of a tenant-owned table. Covers Eloquent only: DB::table(), raw SQL and the unique:/exists:
// validation rules don't see it, and withoutGlobalScope('tenant') removes it.
trait BelongsToTenant
{
    public static function bootBelongsToTenant(): void
    {
        // TenantContext::id() throws without a tenant: a forgotten context fails, it never reads every tenant
        static::addGlobalScope('tenant', fn (Builder $q) => $q->where($q->qualifyColumn('tenant_id'), app(TenantContext::class)->id()));
        // tenant_id always comes from the context, never from input
        static::creating(fn (self $model) => $model->setAttribute('tenant_id', app(TenantContext::class)->id()));
    }

    // save(), delete() and refresh() skip global scopes and filter by id only: with PRIMARY KEY (tenant_id, id)
    // MySQL scans the whole key for that, locking every row it reads
    protected function setKeysForSaveQuery($query): Builder
    {
        return parent::setKeysForSaveQuery($query)->where('tenant_id', $this->getOriginal('tenant_id'));
    }

    protected function setKeysForSelectQuery($query): Builder
    {
        return parent::setKeysForSelectQuery($query)->where('tenant_id', $this->getOriginal('tenant_id'));
    }
}
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
<?php
// database/migrations/2026_10_27_000003_create_appointments.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('appointments', function (Blueprint $table) {
            $table->uuid('tenant_id');
            $table->uuid('id');
            $table->uuid('customer_id');
            $table->uuid('staff_user_id');
            $table->dateTime('starts_at');                        // UTC
            $table->dateTime('ends_at');
            $table->string('status', 20)->default('booked');
            $table->dateTime('created_at')->useCurrent();
            $table->primary(['tenant_id', 'id']);
            $table->foreign('tenant_id')->references('id')->on('tenants');
            // Composite FKs: the database rejects another tenant's customer or staff member
            $table->foreign(['tenant_id', 'customer_id'])->references(['tenant_id', 'id'])->on('customers');
            $table->foreign(['tenant_id', 'staff_user_id'])->references(['tenant_id', 'user_id'])->on('memberships');
            $table->index(['tenant_id', 'staff_user_id', 'starts_at']);   // the overlap check
            $table->index(['tenant_id', 'starts_at']);
        });
        DB::statement('ALTER TABLE appointments ADD CONSTRAINT appointments_time CHECK (ends_at > starts_at)');
        DB::statement("ALTER TABLE appointments ADD CONSTRAINT appointments_status
            CHECK (status IN ('booked', 'confirmed', 'done', 'cancelled', 'no_show'))");
        // No exclusion constraint on MySQL: BookingService locks the staff member instead
    }

    public function down(): void
    {
        Schema::dropIfExists('appointments');
    }
};
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
<?php
// app/Services/BookingService.php

namespace App\Services;

use App\Models\Appointment;
use App\Models\Customer;
use App\Models\Membership;
use App\Support\ApiError;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

final class BookingService
{
    public function book(string $customerId, string $staffUserId, DateTimeInterface $startsAt, DateTimeInterface $endsAt): Appointment
    {
        Gate::authorize('create', [Appointment::class, $staffUserId]);   // AppointmentPolicy

        return DB::transaction(function () use ($customerId, $staffUserId, $startsAt, $endsAt) {
            if (! Customer::query()->whereKey($customerId)->exists()) {   // tenant scope: another tenant's id isn't found
                throw new ApiError(422, 'invalid_reference', 'Khách hàng hoặc nhân viên không hợp lệ.');
            }
            // MySQL has no exclusion constraint: serialize bookings per staff member on their membership row
            $staff = Membership::query()->where('user_id', $staffUserId)->lockForUpdate()->first();
            if ($staff === null) {
                throw new ApiError(422, 'invalid_reference', 'Khách hàng hoặc nhân viên không hợp lệ.');
            }
            // A locking read too: under REPEATABLE READ a plain SELECT reads the snapshot taken by the first read
            // above, before we waited for the lock, and misses the booking committed meanwhile
            $taken = Appointment::query()
                ->where('staff_user_id', $staffUserId)
                ->where('status', '<>', 'cancelled')
                ->where('starts_at', '<', $endsAt)->where('ends_at', '>', $startsAt)   // [starts_at, ends_at)
                ->lockForUpdate()->exists();
            if ($taken) {
                throw new ApiError(409, 'appointment_slot_taken', 'Khung giờ này đã có lịch.');
            }

            return Appointment::create([
                'customer_id' => $customerId, 'staff_user_id' => $staffUserId,
                'starts_at' => $startsAt, 'ends_at' => $endsAt,
            ]);
        });
    }
}
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
<?php
// app/Jobs/SendAppointmentReminder.php

namespace App\Jobs;

use App\Models\Notification;
use App\Models\Tenant;
use App\Reminders\SmsSender;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

// One job per appointment reminder. Ids only: data is read when the job runs, inside the tenant.
// Not models as properties: SerializesModels restores them without global scopes.
final class SendAppointmentReminder implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public int $timeout = 60;   // below the database queue's retry_after (90 s), or a second worker takes the job

    public function __construct(public string $tenantId, public string $notificationId) {}

    public function backoff(): array
    {
        return [30, 120, 600, 1800];   // seconds before attempts 2, 3, 4, 5
    }

    public function handle(TenantContext $tenant, SmsSender $sms): void
    {
        $tenant->run($this->tenantId, fn () => $this->send($sms));
    }

    private function send(SmsSender $sms): void
    {
        $n = Notification::query()->with('appointment.customer')->find($this->notificationId);
        if ($n === null || $n->status !== 'pending') {
            return;                                   // already sent or skipped, or not in this tenant
        }
        $a = $n->appointment;
        if (! in_array($a->status, ['booked', 'confirmed'], true)) {
            $this->mark('skipped');                   // cancelled after it was queued
            return;
        }
        // Brandname SMS: unaccented template text (references/notifications.md); the time in the tenant's zone
        $zone = Tenant::query()->whereKey($this->tenantId)->value('time_zone');
        $text = 'Chao '.Str::ascii($a->customer->full_name).', nhac lich hen cua ban luc '
            .$a->starts_at->setTimezone($zone)->format('H:i d/m/Y').'.';
        $sms->send($a->customer->phone, $text, idempotencyKey: $n->id);   // no transaction open; throws → retried
        $this->mark('sent');
    }

    private function mark(string $status): void
    {
        Notification::query()->whereKey($this->notificationId)->where('status', 'pending')
            ->update(['status' => $status, 'sent_at' => $status === 'sent' ? now() : null]);
    }

    // Every try failed: the job is now in failed_jobs and the notification stays pending. Alert on it.
    public function failed(?Throwable $e): void
    {
        Log::error('reminder failed', ['tenant_id' => $this->tenantId, 'notification_id' => $this->notificationId]);
    }
}
```

- The database queue inserts the job on the same connection, in the transaction: a rollback removed it. Redis and SQS are outside it: `afterCommit()` (lost if the process dies right after commit) or an outbox.
- MySQL 8 workers claim with `FOR UPDATE SKIP LOCKED`. A job reserved longer than `retry_after` (90 s in `config/queue.php`) goes to another worker: `$timeout` below it.
- After 5 tries: `failed_jobs`, `failed()` ran, the row stays `pending`; `queue:retry` reruns it. `withoutOverlapping()` locks in the cache: a shared store in production.

## 7. Tests

On MySQL, without `RefreshDatabase`: its per-test transaction hides rows from the race test's server and from a second connection. Each test seeds its own tenants. `member()` creates tenant, user, membership and a Sanctum token; `as()` first calls `$this->app['auth']->forgetGuards()`, since the test app keeps the previous request's user (without it, requests "as A" ran as B).

```php
<?php
// tests/Feature/CustomersIsolationTest.php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class CustomersIsolationTest extends TestCase
{
    // One row per route with a {customer} (test_every_customer_route_is_listed keeps this list complete)
    public static function crossTenantRoutes(): array
    {
        return [
            'GET customers/{customer}' => ['GET', []],
            'PATCH customers/{customer}' => ['PATCH', ['fullName' => 'hack']],
        ];
    }

    #[DataProvider('crossTenantRoutes')]
    public function test_tenant_a_cannot_touch_tenant_b_data(string $method, array $body): void
    {
        [$a, $b, , $bCustomer] = $this->seedTwoTenants();
        $call = fn (array $as, string $tenantId) => $this->as($as)->json($method, "/v1/t/{$tenantId}/customers/{$bCustomer}", $body);

        // 1. B's id in A's path: route model binding runs inside A's tenant scope
        $call($a, $a['tenantId'])->assertNotFound()->assertJsonPath('error.code', 'not_found');
        // 2. B's path: A is not a member of B
        $call($a, $b['tenantId'])->assertNotFound();
        // 404 is not enough: B's data is unchanged
        $this->as($b)->getJson("/v1/t/{$b['tenantId']}/customers/{$bCustomer}")->assertJsonPath('data.fullName', 'Khách của B');
        // Control: B making the same request succeeds; a wrong route would also answer 404
        $this->assertLessThan(300, $call($b, $b['tenantId'])->status());
    }

    public function test_every_customer_route_is_listed(): void
    {
        $routes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($r) => str_contains($r->uri(), '{customer}'))
            ->flatMap(fn ($r) => array_map(fn ($m) => "$m ".str_replace('v1/t/{tenant}/', '', $r->uri()), array_diff($r->methods(), ['HEAD'])))
            ->sort()->values()->all();
        $this->assertSame($routes, collect(self::crossTenantRoutes())->keys()->sort()->values()->all());
    }
}
```

```php
<?php
// tests/Feature/BookingRaceTest.php

namespace Tests\Feature;

use App\Models\Appointment;
use Illuminate\Http\Client\Pool;
use Illuminate\Support\Facades\Http;
use Tests\Support\TestServer;
use Tests\TestCase;

final class BookingRaceTest extends TestCase
{
    // 10 overlapping slots for one staff member, sent at once to 10 PHP workers: one booking, nine 409
    public function test_ten_concurrent_bookings_one_wins(): void
    {
        $owner = $this->member();
        $customer = $this->customer($owner, 'Khách', '0914000001');
        [$server, $url] = TestServer::start(workers: 10);
        try {
            $responses = Http::pool(fn (Pool $pool) => array_map(fn (int $i) => $pool->withToken($owner['token'])->acceptJson()
                ->post("{$url}/v1/t/{$owner['tenantId']}/appointments", [
                    'customerId' => $customer, 'staffUserId' => $owner['userId'],   // 03:00–04:00, 03:03–04:03, ...
                    'startsAt' => sprintf('2026-11-02T03:%02d:00Z', $i * 3), 'endsAt' => sprintf('2026-11-02T04:%02d:00Z', $i * 3),
                ]), range(0, 9)));
        } finally {
            TestServer::stop($server);
        }

        $statuses = array_count_values(array_map(fn ($r) => $r->status(), $responses));
        ksort($statuses);
        $this->assertSame([201 => 1, 409 => 9], $statuses);
        foreach ($responses as $r) {
            $r->status() === 409 && $this->assertSame('appointment_slot_taken', $r->json('error.code'));
        }
        $this->assertSame(1, $this->inTenant($owner, fn () => Appointment::count()));
    }
}
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
<?php
// app/Tenancy/PostgresTenant.php

namespace App\Tenancy;

use Closure;
use Illuminate\Support\Facades\DB;

// PostgreSQL with RLS: each request or job is one transaction whose first statement sets the tenant.
// set_config(..., true) ends with the transaction; a session-level SET stays on the connection, and Laravel keeps
// one connection per process for every job of a queue worker (and every request of an Octane worker, or of an
// FPM worker with PDO::ATTR_PERSISTENT).
final class PostgresTenant
{
    public static function run(string $tenantId, Closure $fn, string $connection = 'pgsql_app'): mixed
    {
        return DB::connection($connection)->transaction(function () use ($tenantId, $fn, $connection) {
            DB::connection($connection)->select("SELECT set_config('app.tenant_id', ?, true)", [$tenantId]);

            return $fn(DB::connection($connection));
        });
    }
}
```

- Migrations run as the owner on their own connection (`migrate --database=pgsql --path=database/migrations-pgsql`); `ENABLE`/`FORCE ROW LEVEL SECURITY`, policies and grants are `DB::statement` calls in the migration that creates the table.
- The app logs in as `app_user`. A `pgsql` connection's `server_options` adds libpq `-c` options at connect (`statement_timeout`; the tests switch the superuser to `role=app_user`).
- As `app_user`: A sees only A's rows, no tenant sees 0 rows, inserting B's row fails with 42501.
- **Session-level settings leak**: a job ran `set_config('app.tenant_id', ..., false)` and the worker's next job, which set nothing, counted A's rows. One connection serves every job of a `queue:work` process, every request of an Octane worker, and every request of an FPM worker with `PDO::ATTR_PERSISTENT`. With `set_config(..., true)` in `DB::transaction()` the next job counted 0.
