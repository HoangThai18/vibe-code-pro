using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Npgsql;
using Spa.Api.Data;
using Spa.Api.Jobs;
using Spa.Api.Tests.Support;

namespace Spa.Api.Tests;

public sealed class ReminderTests(SpaFactory app) : IClassFixture<SpaFactory>
{
    // As app_user inside the tenant's transaction, like every other write
    static async Task<T> InTenant<T>(Guid tenantId, string sql, params object[] args)
    {
        await using var conn = new NpgsqlConnection(Db.AppCs);
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        await using (var set = new NpgsqlCommand("SELECT set_config('app.tenant_id', $1, true)", conn, tx))
        {
            set.Parameters.Add(new NpgsqlParameter { Value = tenantId.ToString() });
            await set.ExecuteNonQueryAsync();
        }
        await using var cmd = new NpgsqlCommand(sql, conn, tx);
        foreach (var a in args) cmd.Parameters.Add(new NpgsqlParameter { Value = a });
        var result = (T)(await cmd.ExecuteScalarAsync())!;
        await tx.CommitAsync();
        return result;
    }

    static DateTime HoursFromNow(double h)
    {
        var t = DateTime.UtcNow.AddHours(h);
        return new DateTime(t.Year, t.Month, t.Day, t.Hour, t.Minute, 0, DateTimeKind.Utc);
    }

    static Task<Guid> Book(TestTenant t, Guid customer, DateTime startsAt, string status = "booked") => InTenant<Guid>(t.Id,
        "INSERT INTO appointments (tenant_id, id, customer_id, staff_user_id, starts_at, ends_at, status) " +
        "VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6) RETURNING id", t.Id, customer, t.Staff, startsAt, startsAt.AddMinutes(30), status);

    List<Sent> To(FakeSms sms, params string[] phones) => sms.Messages.Where(m => phones.Contains(m.Phone)).ToList();

    [Fact]
    public async Task Sends_once_per_appointment_inside_the_window_in_active_tenants()
    {
        var (t, suspended) = (await Seed.TenantAsync(), await Seed.TenantAsync(status: "suspended"));
        var (phone, phoneS) = (Seed.NewPhone(), Seed.NewPhone());
        var customer = await app.CustomerAsync(t, "Nguyễn Thị Đào", phone);
        var startsAt = HoursFromNow(10);
        await Book(t, customer, HoursFromNow(1));                 // too soon
        await Book(t, customer, startsAt);
        await Book(t, customer, HoursFromNow(12), "cancelled");
        await Book(t, customer, HoursFromNow(30));                // too far
        await Book(suspended, await app.CustomerAsync(suspended, phone: phoneS), startsAt);

        var sms = new FakeSms();
        await app.NewReminderJob(sms).RunOnceAsync(default);
        await app.NewReminderJob(sms).RunOnceAsync(default);   // a rerun sends nothing

        var sent = Assert.Single(To(sms, phone, phoneS));
        Assert.Equal(phone, sent.Phone);
        var local = TimeZoneInfo.ConvertTimeFromUtc(startsAt, TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh"));
        Assert.Equal($"Chao Nguyen Thi Dao, nhac lich hen cua ban luc {local:HH:mm dd'/'MM'/'yyyy}.", sent.Text);
        Assert.Equal("sent", await InTenant<string>(t.Id, "SELECT status FROM notifications WHERE id = $1", sent.Key));
    }

    [Fact]
    public async Task Three_instances_at_once_send_each_reminder_once()
    {
        var t = await Seed.TenantAsync();
        var phones = new List<string>();
        for (var i = 0; i < 5; i++)
        {
            phones.Add(Seed.NewPhone());
            await Book(t, await app.CustomerAsync(t, phone: phones[^1]), HoursFromNow(5 + i));
        }
        var sms = new FakeSms { Delay = TimeSpan.FromMilliseconds(100) };   // slow provider: the runs overlap

        await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => app.NewReminderJob(sms).RunOnceAsync(default)));

        var sent = To(sms, [.. phones]);
        Assert.Equal(5, sent.Count);
        Assert.Equal(5, sent.Select(s => s.Key).Distinct().Count());
    }

    [Fact]
    public async Task A_failed_send_waits_for_the_lease_then_retries_with_the_same_key_or_skips_if_cancelled()
    {
        var t = await Seed.TenantAsync();
        var (phone, phone2) = (Seed.NewPhone(), Seed.NewPhone());
        await Book(t, await app.CustomerAsync(t, phone: phone), HoursFromNow(6));
        var cancelLater = await Book(t, await app.CustomerAsync(t, phone: phone2), HoursFromNow(8));
        var sms = new FakeSms { FailNext = 2 };

        await app.NewReminderJob(sms).RunOnceAsync(default);       // provider down: both stay pending, leased
        await app.NewReminderJob(sms).RunOnceAsync(default);       // within the lease: not claimed again
        Assert.Empty(To(sms, phone, phone2));

        await InTenant<int>(t.Id, "UPDATE appointments SET status = 'cancelled' WHERE id = $1 RETURNING 1", cancelLater);
        await InTenant<int>(t.Id, "UPDATE notifications SET locked_until = now() - interval '1 second' WHERE true RETURNING 1");
        await app.NewReminderJob(sms).RunOnceAsync(default);       // lease expired (as if that instance died)

        Assert.Single(To(sms, phone));
        Assert.Empty(To(sms, phone2));
        Assert.Equal("skipped", await InTenant<string>(t.Id, "SELECT status FROM notifications WHERE appointment_id = $1", cancelLater));
    }

    [Fact]
    public async Task Without_a_tenant_the_worker_sees_no_tenants_but_app_tenant_ids_lists_active_ones()
    {
        var (t, suspended) = (await Seed.TenantAsync(), await Seed.TenantAsync(status: "suspended"));
        await using var scope = app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SpaDb>();
        Assert.Equal(0, await db.Tenants.CountAsync());
        var ids = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM app_tenant_ids() AS id").ToListAsync();
        Assert.Contains(t.Id, ids);
        Assert.DoesNotContain(suspended.Id, ids);
    }

    sealed class Throwing : BackgroundService
    {
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            await Task.Yield();
            throw new InvalidOperationException("boom");
        }
    }

    [Fact]
    public async Task An_exception_escaping_a_BackgroundService_stops_the_host()
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Services.AddHostedService<Throwing>();
        using var host = builder.Build();
        var stopped = new TaskCompletionSource();
        host.Services.GetRequiredService<IHostApplicationLifetime>().ApplicationStopping.Register(() => stopped.TrySetResult());
        await host.StartAsync();
        await stopped.Task.WaitAsync(TimeSpan.FromSeconds(10));   // BackgroundServiceExceptionBehavior.StopHost (the default)
    }
}

public sealed class WorkerFactory : SpaFactory
{
    protected override bool RemindersEnabled => true;
}

public sealed class ReminderServiceTests(WorkerFactory worker) : IClassFixture<WorkerFactory>
{
    [Fact]
    public async Task The_hosted_service_sends_due_reminders_while_the_app_runs()
    {
        var t = await Seed.TenantAsync();
        var phone = Seed.NewPhone();
        var customer = await worker.CustomerAsync(t, phone: phone);   // starts the host, and its ReminderService
        await worker.As(t.Owner).SendAsync(new HttpRequestMessage(HttpMethod.Post, $"/v1/t/{t.Id}/appointments")
        {
            Content = System.Net.Http.Json.JsonContent.Create(new
            {
                customerId = customer, staffUserId = t.Staff,
                startsAt = DateTimeOffset.UtcNow.AddHours(3), endsAt = DateTimeOffset.UtcNow.AddHours(4),
            }),
        });

        for (var i = 0; i < 100 && !worker.Sms.Messages.Any(m => m.Phone == phone); i++) await Task.Delay(100);
        Assert.Contains(worker.Sms.Messages, m => m.Phone == phone);
    }
}
