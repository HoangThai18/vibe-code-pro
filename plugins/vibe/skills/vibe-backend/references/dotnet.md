# ASP.NET Core + EF Core: multi-tenant API on PostgreSQL RLS

The .NET side of `references/multi-tenant.md` (schema), `references/postgres-rls.md` (roles, policies, `app_tenant_ids()`), `references/auth.md` section 4, `references/api-conventions.md` and `references/jobs.md`; read those for the why.

Ran on .NET 10 (SDK 10.0.113), ASP.NET Core minimal APIs, EF Core 10.0.14, Npgsql and Npgsql.EntityFrameworkCore.PostgreSQL 10.0.3, EFCore.NamingConventions 10.0.1, xUnit v3 4.0.2, `WebApplicationFactory` 10.0.14, PostgreSQL 16 with FORCE RLS: migrated from an empty database as `app_owner`, app and tests as `app_user`, 55 tests. Removing any one of these failed a test: the membership check, the permission check, the staff-own rule, `set_config` inside the transaction, the RLS policies, the composite FK, the exclusion constraint, the booking lock, the `xmin` original value, the reminder lease.

## 1. The request: tenant, membership, permission, one transaction

`Program.cs` registers `SpaDb` with `AddDbContext` (not pooled) and `UseSnakeCaseNamingConvention()`, a scoped `RequestTenant`, the project's auth scheme and `PermissionHandler`, and maps `MapGroup("/v1/t/{tenantId:guid}").RequireAuthorization().AddEndpointFilter<TenantFilter>()` (no login: 401; malformed id: 404).

```csharp
// Spa.Api/Tenancy/TenantFilter.cs
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Spa.Api.Data;
using Spa.Api.Http;

namespace Spa.Api.Tenancy;

// The current request's membership, set by TenantFilter before the handler body runs
public sealed class RequestTenant
{
    public Member Member { get; set; } = null!;
}

public static class TenantDb
{
    // One transaction per request or job; its first statement sets the RLS tenant for that transaction only
    public static async Task<IDbContextTransaction> BeginTenantAsync(this SpaDb db, Guid tenantId, CancellationToken ct)
    {
        var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlAsync($"SELECT set_config('app.tenant_id', {tenantId.ToString()}, true)", ct);
        return tx;
    }
}

// On every /v1/t/{tenantId} endpoint: transaction + tenant, membership (404), permission (403), commit
public sealed class TenantFilter(SpaDb db, RequestTenant current, IAuthorizationService authz) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var http = ctx.HttpContext;
        var ct = http.RequestAborted;
        try
        {
            var tenantId = Guid.Parse((string)http.GetRouteValue("tenantId")!);   // {tenantId:guid}: malformed ids are 404 already
            var userId = Guid.Parse(http.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var required = http.GetEndpoint()?.Metadata.GetMetadata<PermissionRequirement>()
                ?? throw ApiException.Forbidden("none");                           // an endpoint without a permission: deny
            await using var tx = await db.BeginTenantAsync(tenantId, ct);
            // Filter on the path tenant: membership_read also matches app.user_id (postgres-rls.md section 4)
            var role = await db.Memberships.Where(m => m.TenantId == tenantId && m.UserId == userId)
                .Select(m => m.Role).SingleOrDefaultAsync(ct)
                ?? throw ApiException.NotFound();                                  // not a member: 404, as if no such tenant
            current.Member = new Member(tenantId, userId, role);
            if (!(await authz.AuthorizeAsync(http.User, current.Member, required)).Succeeded)
                throw ApiException.Forbidden(required.Action);
            var result = await next(ctx);   // the IResult, not written yet: commit first
            await tx.CommitAsync(ct);
            return result;
        }
        catch (ApiException e)
        {
            return e.ToResult();            // the transaction was disposed without commit: rolled back
        }
    }
}
```

- Minimal APIs (the `dotnet new webapi` default): an endpoint filter gets the handler's `IResult` before it is written, so it commits first. `AddEndpointFilter<T>` creates the filter per request: it shares `SpaDb` and the transaction with the handler, which reads the member from `RequestTenant`.
- Not `RequireAuthorization("customer.write")`: policies run before endpoint filters (tested), before the membership is known. `PermissionHandler : AuthorizationHandler<PermissionRequirement, Member>` checks `Permissions.Can(role, action)` (`references/auth.md` section 4); `RequirePermission("x.y")` adds the requirement as metadata and throws at startup on an unknown name; a test asserts every `/v1/t/` route has one.
- Production connects with `Username=app_user`. The tests log in as the superuser with `Options=-c role=app_user`: RLS and privileges are `app_user`'s, and Npgsql's reset keeps the role.

## 2. Isolation: RLS, query filters, DbContext pooling

RLS scopes every statement, raw SQL included, and fails closed; a global query filter (`HasQueryFilter(c => c.TenantId == TenantId)`) only rewrites LINQ, so the app has none. Each row ran as a superuser (a filter alone, as on MySQL or with a BYPASSRLS role) and as `app_user` in tenant A:

| In tenant A | Query filter alone | RLS |
|---|---|---|
| `IgnoreQueryFilters()` (admin or "include deleted" query) | every tenant | A's rows |
| `IgnoreQueryFilters(["soft_delete"])` (EF Core 10 named filters) | tenant filter stays on | A's rows |
| `FromSql($"SELECT * FROM customers")` | filter applied on top | A's rows |
| `Database.SqlQuery<T>`, `ExecuteSql` | every tenant | A's rows |
| `ExecuteUpdate`/`ExecuteDelete` on B's id | 0 rows | 0 rows |
| `Add(new Customer { TenantId = B })`, `SaveChanges` | inserted into B | `DbUpdateException`, SqlState `42501` |
| `AddDbContextPool`; middleware sets `db.TenantId`, a later scope doesn't (job, webhook) | the reused instance still has A | 0 rows |
| `var t = TenantId; HasQueryFilter(c => c.TenantId == t)` | model cached: everyone gets the first tenant | |

Keep a filter only as a second layer, reading a context property, on a context that isn't pooled. Cross-tenant admin views: a separate role and code path with an audit log.

## 3. Connection state and Npgsql's pool

| What | Result |
|---|---|
| `ExecuteSql(set_config(..., true))`, then a query, no transaction | 0 rows: EF Core runs each statement alone, returning the connection after it |
| Session-level `set_config(..., false)` or `SET`; close; next request on that backend | `''`: Npgsql resets a pooled connection before its next command (`DISCARD ALL`, or with prepared statements `SET SESSION AUTHORIZATION DEFAULT; RESET ALL; ...`) |
| Same with `No Reset On Close=true` | the next request sees A's rows |
| `Multiplexing=true`; PgBouncer transaction mode | no reset (Npgsql source); `references/postgres-rls.md` section 7, pitfall 4. Not tested |
| `pg_advisory_lock`, closed without unlock | held while the connection idles in the pool: use `pg_advisory_xact_lock` |
| `EnableRetryOnFailure()` | `BeginTransaction` and `ExecuteSql` work, the first LINQ query throws `InvalidOperationException`; retry from the client with an `Idempotency-Key` |

## 4. EF Core: booking, queries, errors

```csharp
// Spa.Api/Appointments/AppointmentEndpoints.cs
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Spa.Api.Data;
using Spa.Api.Http;
using Spa.Api.Tenancy;

namespace Spa.Api.Appointments;

public sealed record BookAppointment(Guid CustomerId, Guid StaffUserId, DateTimeOffset StartsAt, DateTimeOffset EndsAt);

public static class AppointmentEndpoints
{
    public static void MapAppointments(this RouteGroupBuilder t) =>
        t.MapPost("/appointments", Book).RequirePermission("appointment.write");

    static async Task<IResult> Book(SpaDb db, RequestTenant t, BookAppointment body, CancellationToken ct)
    {
        var m = t.Member;
        // Per-record rule (auth.md section 5): staff book only for themselves
        if (m.Role == "staff" && body.StaffUserId != m.UserId) throw ApiException.Forbidden("appointment.write");
        if (body.EndsAt <= body.StartsAt) throw ApiException.Invalid("endsAt > startsAt");
        var a = new Appointment
        {
            TenantId = m.TenantId, Id = Guid.CreateVersion7(), CustomerId = body.CustomerId, StaffUserId = body.StaffUserId,
            StartsAt = body.StartsAt.UtcDateTime, EndsAt = body.EndsAt.UtcDateTime,
        };
        // One booking at a time per staff member: concurrent overlapping inserts can deadlock (40P01) in the
        // exclusion check. The constraint stays the guarantee; the lock ends with the transaction.
        await db.Database.ExecuteSqlAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({m.TenantId.ToString()} || {body.StaffUserId.ToString()}, 0))", ct);
        db.Appointments.Add(a);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (Exception e) when (e.SqlState() is PostgresErrorCodes.ExclusionViolation or PostgresErrorCodes.DeadlockDetected)
        {
            // 23P01: appointments_no_overlap (data-layer.md section 6). 40P01, from a path without the lock: lost the same race
            throw new ApiException(409, "appointment_slot_taken", "Khung giờ này đã có lịch.");
        }
        catch (DbUpdateException e) when (e.SqlState() == PostgresErrorCodes.ForeignKeyViolation)
        {
            // 23503: customer or staff not in this tenant (composite FKs); don't echo the DB message
            throw new ApiException(422, "invalid_reference", "Khách hàng hoặc nhân viên không hợp lệ.");
        }
        return Results.Created($"/v1/t/{m.TenantId}/appointments/{a.Id}",
            new { data = new { a.Id, a.CustomerId, a.StaffUserId, a.StartsAt, a.EndsAt, a.Status } });
    }
}
```

- The lock: 100 rounds of 10 concurrent overlapping bookings, released together just before the insert. Without lock or mapping, 19 rounds had all nine losers fail with `40P01 deadlock detected` inside the exclusion check (500s). With the mapping alone the rounds looked right but hid 81 deadlocks (the test counts them). With the lock: 300 rounds, no deadlock. Every write that can create an overlap (reschedule, un-cancel) takes the same lock.
- Npgsql's EF provider reports a 40P01 from `SaveChanges` as `InvalidOperationException` ("transient failure") → `DbUpdateException` → `PostgresException`, so `SqlState()` walks `InnerException`. `ExecuteUpdate`, `ExecuteDelete` and raw SQL throw `PostgresException` itself.
- N+1, counted by an interceptor: a query per customer runs 1 + N statements, `Include` 1 (whole rows), a `Select` projection with `c.Appointments.Where(...).Min(...)` 1. The customer list runs 3 (`set_config`, membership, page) for 3 or 30 customers.
- Keyset pages: `EF.Functions.LessThan(ValueTuple.Create(c.CreatedAt, c.Id), ValueTuple.Create(at, id))` becomes `(created_at, id) < (@p, @p)`; the cursor carries `CreatedAt.Ticks` (PostgreSQL keeps microseconds).
- `xmin`: `Property(c => c.Version).IsRowVersion()` on a `uint`. PATCH puts the client's version in `Entry(c).Property(x => x.Version).OriginalValue`; `DbUpdateConcurrencyException` → 409 `version_conflict`.
- Npgsql writes only UTC `DateTime` to `timestamptz` (`DateTime.Now` throws): take `DateTimeOffset`, store `.UtcDateTime`.
- Pin `Microsoft.EntityFrameworkCore.Relational` to the `Design` version, or the test project fails with MSB3277 (the provider asks only for ≥ 10.0.4).

## 5. Migrations

`dotnet ef migrations add` writes tables, keys, composite FKs, unique indexes, CHECKs and defaults from `OnModelCreating`. The rest are hand-written migrations calling `migrationBuilder.Sql(...)` on embedded copies of the canonical SQL: `CurrentTenant` (`app_current_tenant()`, before the tables' `DEFAULT`), and right after the tables `TenantSecurity` (policies from `references/postgres-rls.md` sections 2–3, the exclusion constraint from `references/data-layer.md` section 6), so no table exists without RLS.

For CI use a bundle (`dotnet ef migrations bundle`): built once, each deploy runs `efbundle --connection "<app_owner>"` with no SDK or source, under EF's migration lock. An idempotent script (`migrations script --idempotent`) is for SQL review; it ran twice on an empty database and matched the bundle's schema.

- The bundle builds for a runtime: set `<RuntimeIdentifiers>linux-x64</RuntimeIdentifiers>` and `--target-runtime linux-x64`, or it rewrites `packages.lock.json` and `dotnet restore --locked-mode` fails.
- The script pastes raw SQL into `DO $EF$ ... THEN <sql> END IF`: end each `migrationBuilder.Sql` with `;` (without it only the script fails); function bodies come out re-indented.
- On an empty database the bundle first logs a failed `SELECT` on `__EFMigrationsHistory`: expected. Each migration gets its own transaction.
- Outside EF: roles, `CREATE EXTENSION btree_gist`, `app_tenant_ids()` (owned by `app_definer`). A test asserts `Database.HasPendingModelChanges()` is false.

## 6. The reminder job

```csharp
// Spa.Api/Jobs/ReminderJob.cs
using Microsoft.EntityFrameworkCore;
using Spa.Api.Data;
using Spa.Api.Tenancy;

namespace Spa.Api.Jobs;

public sealed record DueReminder(Guid Id, string Phone, string FullName, DateTime StartsAt, string TimeZone, bool Active);

// No HttpContext, no tenant: list tenants with app_tenant_ids(), then one scope and transaction per tenant
public sealed partial class ReminderJob(IServiceScopeFactory scopes, ISmsSender sms, ILogger<ReminderJob> log)
{
    public async Task RunOnceAsync(CancellationToken ct)
    {
        List<Guid> tenants;
        await using (var scope = scopes.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SpaDb>();
            tenants = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM app_tenant_ids() AS id").ToListAsync(ct);
        }
        foreach (var tenantId in tenants)
        {
            try
            {
                await RunTenantAsync(tenantId, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogError(e, "Reminders failed for tenant {TenantId}", tenantId);   // the other tenants still run
            }
        }
    }

    async Task RunTenantAsync(Guid tenantId, CancellationToken ct)
    {
        List<DueReminder> due;
        await using (var scope = scopes.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SpaDb>();
            await using var tx = await db.BeginTenantAsync(tenantId, ct);
            // One row per appointment (UNIQUE + ON CONFLICT); the wide window catches up a missed scan
            await db.Database.ExecuteSqlAsync($"""
                INSERT INTO notifications (tenant_id, appointment_id, kind)
                SELECT tenant_id, id, 'reminder_24h' FROM appointments
                 WHERE status IN ('booked', 'confirmed')
                   AND starts_at > now() + interval '2 hours' AND starts_at <= now() + interval '24 hours'
                ON CONFLICT (tenant_id, appointment_id, kind) DO NOTHING
                """, ct);
            // Claim with a 5-minute lease: other instances skip the rows until they are marked or the lease runs out
            due = await db.Database.SqlQuery<DueReminder>($"""
                UPDATE notifications n SET locked_until = now() + interval '5 minutes'
                  FROM appointments a, customers c, tenants t
                 WHERE n.id IN (SELECT id FROM notifications
                                 WHERE status = 'pending' AND (locked_until IS NULL OR locked_until < now())
                                 ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED)
                   AND a.tenant_id = n.tenant_id AND a.id = n.appointment_id
                   AND c.tenant_id = a.tenant_id AND c.id = a.customer_id AND t.id = n.tenant_id
                RETURNING n.id, c.phone, c.full_name, a.starts_at, t.time_zone, a.status IN ('booked', 'confirmed') AS active
                """).ToListAsync(ct);
            await tx.CommitAsync(ct);
        }
        foreach (var r in due)
        {
            if (r.Active)
            {
                try
                {
                    await sms.SendAsync(r.Phone, ReminderText.For(r), r.Id, ct);   // outside any transaction
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    log.LogWarning(e, "Reminder {NotificationId} not sent", r.Id);
                    continue;
                }
            }
            await MarkAsync(tenantId, r.Id, r.Active ? "sent" : "skipped", ct);
        }
    }
}
```

- `ReminderService : BackgroundService` calls `RunOnceAsync` on a `PeriodicTimer` and catches each run's exception: one escaping `ExecuteAsync` stops the host, API included (tested). `Reminders:Enabled=true` turns it on per instance.
- `db.Tenants` returns 0 rows to the worker (no tenant set); each tenant gets its own scope (a fresh `SpaDb`) and transaction.
- Three instances at once sent each of 5 reminders once. Without the lease condition they sent duplicates; without `SKIP LOCKED` they only waited. A failed send stays `pending` and is retried with the same key after the lease; a cancelled appointment is marked `skipped`.
- `SqlQuery<DueReminder>` runs `UPDATE ... RETURNING` as written, mapping `full_name` to `FullName` by the naming convention. Message text: `references/jobs.md` section 3.

## 7. Tests

`SpaFactory : WebApplicationFactory<Program>` points `ConnectionStrings:App` at `app_user`; `ConfigureTestServices` adds a header auth scheme, a fake `ISmsSender` and (`ConfigureDbContext<SpaDb>`) interceptors that count commands, hold bookings at a barrier and count 40P01s. Seeding runs as `app_user` in the tenant's transaction. xUnit v3 4.x needs `"test": { "runner": "Microsoft.Testing.Platform" }` in `global.json` for `dotnet test`; one shared database: `[assembly: Parallelization(Mode = ParallelMode.None)]`.

| Test | Expect |
|---|---|
| 100 rounds × 10 concurrent overlapping bookings, barrier before the lock | each round one 201, nine 409 `appointment_slot_taken`; no 40P01 |
| GET/PATCH/DELETE `customers/:id`: B's id in A's path; B's path as A | 404, 404; B unchanged; B's own request succeeds |
| A's list; B's list as A; `tenantId` in the body; booking with B's customer | A's row, none of B's; 404; ignored; 422 |
| Role × action `[Theory]`; no login; not a member; bad tenant id; staff POST customer | as `references/auth.md`; 401; 404; 404; 403 |
| Staff books another staff, self; manager books staff | 403, 201, 201 |
| Duplicate phone (POST, PATCH); in another tenant | 409 `customer_phone_taken`; 201 |
| 25 customers in pages of 10; stale `version` | each once, newest first; 409 |
| Back-to-back slots; other staff; overlap sent as `+07:00`; delete a booked customer | 201, 201, 409; 409 |
| Reminders 1, 10, 30 h ahead, one cancelled, one in a suspended tenant, run twice | one message, unaccented, `Asia/Ho_Chi_Minh` time |
| Sections 2 and 3 | a test per row, except where marked |

## 8. SQL Server

Not tested here; check the current docs. Row-level security exists (`CREATE SECURITY POLICY`, predicates reading `SESSION_CONTEXT(N'tenant_id')` set by `sp_set_session_context`), but the value lives for the session, not the transaction: set it at the start of each unit of work and check that the pool's reset clears it. No exclusion constraints (guard double booking another way, keep the race test); `rowversion` instead of `xmin`; `WITH (UPDLOCK, READPAST, ROWLOCK)` instead of `SKIP LOCKED`; unique violations are `SqlException.Number` 2627 or 2601.
