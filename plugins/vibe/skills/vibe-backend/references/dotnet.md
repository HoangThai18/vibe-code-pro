# ASP.NET Core + EF Core: multi-tenant API on PostgreSQL RLS

The .NET side of `references/multi-tenant.md` (schema), `references/postgres-rls.md` (roles, policies, `app_tenant_ids()`), `references/auth.md` section 4, `references/api-conventions.md` and `references/jobs.md`; read those for the why.

Ran on .NET 10 (SDK 10.0.113), ASP.NET Core minimal APIs, EF Core 10.0.14, Npgsql and Npgsql.EntityFrameworkCore.PostgreSQL 10.0.3, EFCore.NamingConventions 10.0.1, xUnit v3 4.0.2, `WebApplicationFactory` 10.0.14, PostgreSQL 16 with FORCE RLS: migrated from an empty database as `app_owner`, app and tests as `app_user`, 55 tests. Removing any one of these failed a test: the membership check, the permission check, the staff-own rule, `set_config` inside the transaction, the RLS policies, the composite FK, the exclusion constraint, the `xmin` original value, the reminder lease.

## Contents
1. Layout
2. The request: tenant, membership, permission, one transaction
3. Isolation: RLS, query filters, DbContext pooling
4. Connection state and Npgsql's pool
5. EF Core: queries, pages, concurrency, errors
6. Migrations
7. The reminder job
8. Tests
9. SQL Server

## 1. Layout

| Decision | Choice | Why |
|---|---|---|
| Endpoints | Minimal APIs (the `dotnet new webapi` default), one group `/v1/t/{tenantId:guid}` | A malformed id doesn't match: 404. An endpoint filter gets the handler's `IResult` before it is written, so it commits first |
| Membership, permission, transaction | One endpoint filter on the group | `RequireAuthorization("customer.write")` policies run before endpoint filters (tested), before the membership is known: the filter checks the permission with the membership as the resource |
| Tenant scoping | RLS, no tenant query filter | Section 3 |
| DbContext | `AddDbContext` (not pooled), snake_case, `Guid.CreateVersion7()` ids | Section 3 |

## 2. The request: tenant, membership, permission, one transaction

```csharp
// Spa.Api/Program.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Spa.Api.Appointments;
using Spa.Api.Customers;
using Spa.Api.Data;
using Spa.Api.Jobs;
using Spa.Api.Tenancy;

var builder = WebApplication.CreateBuilder(args);

// Connects as app_user (NOSUPERUSER NOBYPASSRLS, not the table owner)
builder.Services.AddDbContext<SpaDb>(o => o
    .UseNpgsql(builder.Configuration.GetConnectionString("App"))
    .UseSnakeCaseNamingConvention());
builder.Services.AddScoped<RequestTenant>();
builder.Services.AddAuthentication();   // the project's scheme (cookie or JWT, auth.md); tests add a header scheme
builder.Services.AddAuthorization();
builder.Services.AddSingleton<IAuthorizationHandler, PermissionHandler>();
// Worker instances: Reminders:Enabled=true, plus the SMS provider's ISmsSender (notifications.md)
if (builder.Configuration.GetValue<bool>("Reminders:Enabled"))
    builder.Services.AddSingleton<ReminderJob>().AddHostedService<ReminderService>();

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();

var tenant = app.MapGroup("/v1/t/{tenantId:guid}")
    .RequireAuthorization()                // signed in, or 401
    .AddEndpointFilter<TenantFilter>();    // member (404), permission (403), one transaction
tenant.MapCustomers();
tenant.MapAppointments();

app.Run();
```

```csharp
// Spa.Api/Tenancy/TenantFilter.cs
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Spa.Api.Data;
using Spa.Api.Http;

namespace Spa.Api.Tenancy;

// Scoped: the membership of the current request, set by TenantFilter before the handler body runs
public sealed class RequestTenant
{
    public Member Member { get; set; } = null!;
}

public static class TenantDb
{
    // One transaction per request or job unit; its first statement sets the RLS tenant for this transaction only
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
            var result = await next(ctx);   // the handler's IResult, not written yet: commit first
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

- `PermissionHandler : AuthorizationHandler<PermissionRequirement, Member>` succeeds when `Permissions.Can(member.Role, action)` (the table of `references/auth.md` section 4). `RequirePermission("x.y")` adds the requirement as endpoint metadata and throws at startup on an unknown name; a test asserts every `/v1/t/` route has one.
- Handlers read the member from the scoped `RequestTenant` (minimal APIs bind parameters before filters run). `AddEndpointFilter<T>` creates the filter per request, sharing the scoped `SpaDb` and its transaction with the handler.
- Production connects with `Username=app_user`. The tests log in as the superuser with `Options=-c role=app_user`: RLS and privileges are `app_user`'s, and Npgsql's reset keeps the role.

## 3. Isolation: RLS, query filters, DbContext pooling

RLS scopes every statement, raw SQL included, and fails closed. A global query filter (`HasQueryFilter(c => c.TenantId == TenantId)`) only rewrites LINQ. Each row ran as a superuser (a filter alone: MySQL, SQL Server without a security policy, a BYPASSRLS role) and as `app_user` in tenant A:

| In tenant A | Query filter alone | RLS |
|---|---|---|
| `IgnoreQueryFilters()` (admin or "include deleted" query) | every tenant | A's rows |
| `IgnoreQueryFilters(["soft_delete"])` (EF Core 10 named filters) | tenant filter stays on | A's rows |
| `FromSql($"SELECT * FROM customers")` | filter applied on top | A's rows |
| `Database.SqlQuery<T>`, `ExecuteSql` | every tenant | A's rows |
| `ExecuteUpdate`/`ExecuteDelete` on B's id | 0 rows | 0 rows |
| `Add(new Customer { TenantId = B })`, `SaveChanges` | inserted into B | `DbUpdateException`, SqlState `42501` |
| `AddDbContextPool`; middleware sets `db.TenantId`, the next scope doesn't (job, webhook) | the reused instance still has A | 0 rows |
| `var t = TenantId; HasQueryFilter(c => c.TenantId == t)` | model cached: everyone gets the first tenant | |

Keep a filter only as a second layer, reading a context property, on a context that isn't pooled (EF Core's docs show a scoped factory that sets the tenant on each pooled instance). Cross-tenant admin views: a separate role and code path with an audit log (`references/multi-tenant.md` section 4).

## 4. Connection state and Npgsql's pool

| What | Result |
|---|---|
| `ExecuteSql(set_config(..., true))`, then a query, no transaction | 0 rows: EF Core runs each statement alone and returns the connection after it |
| Same inside `BeginTransactionAsync` | the tenant holds for the unit |
| Session-level `set_config(..., false)` or `SET`; close; the next request on that backend | `''`: Npgsql resets a pooled connection before its next command (`DISCARD ALL`, or with prepared statements `SET SESSION AUTHORIZATION DEFAULT; RESET ALL; ...`) |
| Same with `No Reset On Close=true` | the next request sees A's rows |
| `Multiplexing=true`, or PgBouncer in transaction mode | no reset with multiplexing (Npgsql source); PgBouncer: `references/postgres-rls.md` section 7, pitfall 4. Not tested |
| `pg_advisory_lock`, closed without unlock | held while the connection idles in the pool: use `pg_try_advisory_xact_lock` |
| `EnableRetryOnFailure()` | `BeginTransaction` and `ExecuteSql` work, the first LINQ query throws `InvalidOperationException`; retry from the client with an `Idempotency-Key` |

## 5. EF Core: queries, pages, concurrency, errors

```csharp
// Spa.Api/Customers/CustomerEndpoints.cs
using Microsoft.EntityFrameworkCore;
using Spa.Api.Data;
using Spa.Api.Http;
using Spa.Api.Tenancy;

namespace Spa.Api.Customers;

public sealed record CustomerDto(Guid Id, string FullName, string Phone, string? Email, DateOnly? Birthday,
    DateTime CreatedAt, uint Version, DateTime? NextAppointmentAt);

public static partial class CustomerEndpoints
{
    public static void MapCustomers(this RouteGroupBuilder t)
    {
        t.MapGet("/customers", List).RequirePermission("customer.read");
        t.MapGet("/customers/{id:guid}", Get).RequirePermission("customer.read");
        t.MapPost("/customers", Create).RequirePermission("customer.write");
        t.MapPatch("/customers/{id:guid}", Update).RequirePermission("customer.write");
        t.MapDelete("/customers/{id:guid}", Delete).RequirePermission("customer.write");
    }

    // A projection: one statement per page, the next appointment as a correlated subquery (no N+1, no Include)
    static IQueryable<CustomerDto> ToDto(this IQueryable<Customer> q, DateTime now) => q.Select(c => new CustomerDto(
        c.Id, c.FullName, c.Phone, c.Email, c.Birthday, c.CreatedAt, c.Version,
        c.Appointments.Where(a => a.StartsAt > now && (a.Status == "booked" || a.Status == "confirmed"))
            .Min(a => (DateTime?)a.StartsAt)));

    static async Task<IResult> List(SpaDb db, int? limit, string? cursor, CancellationToken ct)
    {
        var take = limit ?? 20;
        if (take is < 1 or > 100) throw ApiException.Invalid("limit: 1–100");
        var q = db.Customers.AsQueryable();   // no tenant condition: RLS adds it
        if (cursor is not null)
        {
            var (at, id) = DecodeCursor(cursor);
            // Row value comparison (created_at, id) < (@at, @id): keyset paging on the customers_created index
            q = q.Where(c => EF.Functions.LessThan(ValueTuple.Create(c.CreatedAt, c.Id), ValueTuple.Create(at, id)));
        }
        var rows = await q.OrderByDescending(c => c.CreatedAt).ThenByDescending(c => c.Id)
            .Take(take + 1).ToDto(DateTime.UtcNow).ToListAsync(ct);
        var next = rows.Count > take ? EncodeCursor(rows[take - 1]) : null;
        return Results.Ok(new { data = rows.Take(take), nextCursor = next });
    }
}
```

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
        db.Appointments.Add(a);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException e) when (e.SqlState() == PostgresErrorCodes.ExclusionViolation)   // 23P01
        {
            // appointments_no_overlap (data-layer.md section 6): also under concurrency
            throw new ApiException(409, "appointment_slot_taken", "Khung giờ này đã có lịch.");
        }
        catch (DbUpdateException e) when (e.SqlState() == PostgresErrorCodes.ForeignKeyViolation)  // 23503
        {
            // Customer or staff not in this tenant (composite FKs); don't echo the DB message
            throw new ApiException(422, "invalid_reference", "Khách hàng hoặc nhân viên không hợp lệ.");
        }
        return Results.Created($"/v1/t/{m.TenantId}/appointments/{a.Id}",
            new { data = new { a.Id, a.CustomerId, a.StaffUserId, a.StartsAt, a.EndsAt, a.Status } });
    }
}
```

- N+1, counted with a `DbCommandInterceptor`: a query per customer runs 1 + N statements; `Include` runs 1 but loads whole appointment rows; the projection runs 1. The list endpoint runs 3 (`set_config`, membership, page) for 3 or 30 customers.
- `xmin`: `Property(c => c.Version).IsRowVersion()` on a `uint`, no migration column. PATCH sets the client's version as `db.Entry(c).Property(x => x.Version).OriginalValue`; `DbUpdateConcurrencyException` → 409 `version_conflict`.
- `SaveChanges` wraps errors in `DbUpdateException` (inner `PostgresException` with `SqlState`); `ExecuteUpdate`, `ExecuteDelete` and raw SQL throw `PostgresException` itself.
- Npgsql writes only UTC `DateTime` to `timestamptz` (`DateTime.Now` throws "only UTC is supported"): take `DateTimeOffset`, store `.UtcDateTime`.
- Reference `Microsoft.EntityFrameworkCore.Relational` at the `Microsoft.EntityFrameworkCore.Design` version: the provider asks for ≥ 10.0.4, Design is `PrivateAssets="all"`, and the test project failed with MSB3277.

## 6. Migrations

`dotnet ef migrations add` writes tables, keys, composite FKs, unique indexes, CHECKs and defaults from `OnModelCreating`. The rest goes in hand-written migrations running embedded copies of the canonical SQL: `CurrentTenant` before the tables (`DEFAULT app_current_tenant()` needs it), this one after them:

```csharp
// Spa.Api/Migrations/20261027080000_TenantSecurity.cs
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Spa.Api.Data;

namespace Spa.Api.Migrations;

// Hand-written, right after the tables: what EF Core can't model. Same migration, so no table exists without RLS.
[DbContext(typeof(SpaDb))]
[Migration("20261027080000_TenantSecurity")]
public sealed class TenantSecurity : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql(SqlScripts.Read("tenant-isolation.sql"));   // customers, appointments (postgres-rls.md section 2)
        migrationBuilder.Sql(SqlScripts.Read("login.sql"));              // memberships, tenants (section 3)
        migrationBuilder.Sql(SqlScripts.Read("notifications-rls.sql"));
        migrationBuilder.Sql(SqlScripts.Read("no-overlap.sql"));         // EXCLUDE USING gist (data-layer.md section 6)
    }
}
```

| | Bundle (`dotnet ef migrations bundle`) | `dotnet ef migrations script --idempotent` |
|---|---|---|
| Use | CI builds it once; each deploy runs `efbundle --connection "<app_owner>"`, no SDK or source | SQL review, a DBA |
| Ran | on an empty database, with EF's migration lock | twice on another empty database; schema equal to the bundle's |

- The bundle builds for a runtime: set `<RuntimeIdentifiers>linux-x64</RuntimeIdentifiers>` and `--target-runtime linux-x64`, or it rewrites `packages.lock.json` and `dotnet restore --locked-mode` fails.
- The script pastes raw SQL into `DO $EF$ ... THEN <sql> END IF`: end each `migrationBuilder.Sql` with `;` (without it only the script fails); function bodies come out re-indented.
- On an empty database the bundle first logs a failed `SELECT` on `__EFMigrationsHistory`: expected. Each migration gets its own transaction.
- Outside EF: roles, `CREATE EXTENSION btree_gist`, `app_tenant_ids()` (a superuser hands it to `app_definer`).
- A test asserts `Database.HasPendingModelChanges()` is false: a model change without a migration fails CI.

## 7. The reminder job

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
            // db.Tenants here returns 0 rows under RLS; the SECURITY DEFINER function returns the active ids
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
            // One row per appointment (UNIQUE + ON CONFLICT): reruns and other instances add nothing.
            // Wide window: a missed scan is caught up by the next one.
            await db.Database.ExecuteSqlAsync($"""
                INSERT INTO notifications (tenant_id, appointment_id, kind)
                SELECT tenant_id, id, 'reminder_24h' FROM appointments
                 WHERE status IN ('booked', 'confirmed')
                   AND starts_at > now() + interval '2 hours' AND starts_at <= now() + interval '24 hours'
                ON CONFLICT (tenant_id, appointment_id, kind) DO NOTHING
                """, ct);
            // Claim with a 5-minute lease: other instances and later scans skip the rows until they are marked or the
            // lease runs out (this instance died). SKIP LOCKED only keeps concurrent claimers from waiting on each other.
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
                    // Still pending: retried with the same key once the lease expires (backoff)
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
- No `HttpContext`: tenants come from `app_tenant_ids()` (`db.Tenants` returns 0 rows to the worker); each gets its own scope (a fresh `SpaDb`) and transaction.
- Three instances at once sent each of 5 reminders once. Without the lease condition they sent duplicates; without `SKIP LOCKED` (lease kept) they only waited.
- A failed send stays `pending`, retried with the same idempotency key after the lease; an appointment cancelled meanwhile is marked `skipped`.
- `SqlQuery<DueReminder>` runs the `UPDATE ... RETURNING` as written and maps `full_name` to `FullName` by the naming convention. Message text: `references/jobs.md` section 3. Hangfire or Quartz.NET add retries and dashboards (not tested here).

## 8. Tests

`SpaFactory : WebApplicationFactory<Program>` sets `ConnectionStrings:App` to the `app_user` connection; `ConfigureTestServices` adds a header auth scheme, a fake `ISmsSender` and (`ConfigureDbContext<SpaDb>`) the command counter. Seeding runs as `app_user` inside the tenant's transaction, like sign-up. xUnit v3 4.x runs on Microsoft.Testing.Platform: on the .NET 10 SDK `dotnet test` needs `"test": { "runner": "Microsoft.Testing.Platform" }` in `global.json`. One shared database: `[assembly: Parallelization(Mode = ParallelMode.None)]`.

| Test | Expect |
|---|---|
| 10 concurrent bookings of overlapping slots for one staff member (`Task.WhenAll` through the factory's client) | one 201, nine 409 `appointment_slot_taken` |
| GET/PATCH/DELETE `customers/:id`: B's id in A's path; B's path as A | 404, 404; B unchanged; B's own request succeeds |
| A's list; B's list as A; `tenantId` in the body | A's row, none of B's; 404; ignored |
| Booking with B's customer | 422 `invalid_reference` (A's customer: 201) |
| Role × action `[Theory]`; no login; not a member; bad tenant id; staff POST customer | as `references/auth.md`; 401; 404; 404; 403 |
| Staff books another staff, self; manager books staff | 403, 201, 201 |
| Phones `0912 345 678`, `+84 912.345.678`, `84912345678`, `912345678` | `0912345678` |
| Duplicate phone (POST, PATCH); in another tenant | 409 `customer_phone_taken`; 201 |
| 25 customers in pages of 10; stale `version` | each once, newest first; 409 |
| Back-to-back slots; other staff; overlap sent as `+07:00`; delete a booked customer | 201, 201, 409; 409 |
| Reminders 1, 10, 30 h ahead, one cancelled, one in a suspended tenant, run twice | one message, unaccented, `Asia/Ho_Chi_Minh` time |
| Sections 3 and 4 | a test per row, except where marked |

## 9. SQL Server

Not tested here; check the current docs.
- Row-level security: `CREATE SECURITY POLICY` with filter and block predicates reading `SESSION_CONTEXT(N'tenant_id')`, set by `sp_set_session_context`. It lives for the session, not the transaction: set it at the start of every unit of work and check that the pool's reset clears it.
- No exclusion constraints (guard double booking another way, keep the race test); `rowversion` instead of `xmin`; `WITH (UPDLOCK, READPAST, ROWLOCK)` instead of `SKIP LOCKED`; no row value comparisons; unique violations are `SqlException.Number` 2627 or 2601.
