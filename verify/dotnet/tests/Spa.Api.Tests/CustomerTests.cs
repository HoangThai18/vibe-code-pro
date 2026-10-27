using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spa.Api.Data;
using Spa.Api.Tests.Support;

namespace Spa.Api.Tests;

public sealed record CustomerJson(Guid Id, string FullName, string Phone, uint Version, DateTime CreatedAt, DateTime? NextAppointmentAt);

public sealed class CustomerTests(SpaFactory app) : IClassFixture<SpaFactory>
{
    [Theory]
    [InlineData("0912 345 678")]
    [InlineData("+84 912.345.678")]
    [InlineData("84912345678")]
    [InlineData("912345678")]
    public async Task Phone_is_stored_as_0912345678(string input)
    {
        var t = await Seed.TenantAsync();
        var res = await app.As(t.Owner).PostAsJsonAsync($"/v1/t/{t.Id}/customers", new { fullName = "Thảo", phone = input });
        Assert.Equal("0912345678", (await res.Content.ReadFromJsonAsync<Envelope<CustomerJson>>())!.Data.Phone);
    }

    [Fact]
    public async Task Duplicate_phone_in_the_tenant_is_409_on_create_and_update_but_free_in_another_tenant()
    {
        var (t, other) = (await Seed.TenantAsync(), await Seed.TenantAsync());
        var phone = Seed.NewPhone();
        await app.CustomerAsync(t, phone: phone);
        var second = await app.CustomerAsync(t);

        var dup = await app.As(t.Owner).PostAsJsonAsync($"/v1/t/{t.Id}/customers", new { fullName = "Khác", phone });
        Assert.Equal(HttpStatusCode.Conflict, dup.StatusCode);
        Assert.Equal("customer_phone_taken", (await dup.Content.ReadFromJsonAsync<ErrorBody>())!.Error.Code);
        var patch = await app.As(t.Owner).PatchAsJsonAsync($"/v1/t/{t.Id}/customers/{second}", new { phone });
        Assert.Equal("customer_phone_taken", (await patch.Content.ReadFromJsonAsync<ErrorBody>())!.Error.Code);

        await app.CustomerAsync(other, phone: phone);   // UNIQUE (tenant_id, phone): another spa may have it
    }

    [Fact]
    public async Task Invalid_input_is_400()
    {
        var t = await Seed.TenantAsync();
        var bad = await app.As(t.Owner).PostAsJsonAsync($"/v1/t/{t.Id}/customers", new { fullName = "Thảo", phone = "12345" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await app.As(t.Owner).GetAsync($"/v1/t/{t.Id}/customers?limit=101")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await app.As(t.Owner).GetAsync($"/v1/t/{t.Id}/customers?cursor=%%%")).StatusCode);
    }

    [Fact]
    public async Task Pages_cover_every_row_once_in_order()
    {
        var t = await Seed.TenantAsync();
        var created = new List<Guid>();
        for (var i = 0; i < 25; i++) created.Add(await app.CustomerAsync(t, $"Khách {i}"));

        var seen = new List<CustomerJson>();
        string? cursor = null;
        do
        {
            var page = await app.As(t.Owner).GetFromJsonAsync<ListOf<CustomerJson>>(
                $"/v1/t/{t.Id}/customers?limit=10" + (cursor is null ? "" : $"&cursor={cursor}"));
            seen.AddRange(page!.Data);
            cursor = page.NextCursor;
        } while (cursor is not null);

        Assert.Equal(25, seen.Count);
        Assert.Equal(created.Order(), seen.Select(c => c.Id).Order());
        Assert.Equal(seen.OrderByDescending(c => c.CreatedAt).ThenByDescending(c => c.Id).Select(c => c.Id), seen.Select(c => c.Id));
    }

    [Fact]
    public async Task Stale_version_is_409_version_conflict()
    {
        var t = await Seed.TenantAsync();
        var id = await app.CustomerAsync(t);
        var url = $"/v1/t/{t.Id}/customers/{id}";
        var version = (await app.As(t.Owner).GetFromJsonAsync<Envelope<CustomerJson>>(url))!.Data.Version;

        var first = await app.As(t.Owner).PatchAsJsonAsync(url, new { fullName = "Tên mới", version });
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.NotEqual(version, (await first.Content.ReadFromJsonAsync<Envelope<CustomerJson>>())!.Data.Version);   // xmin moved

        var stale = await app.As(t.Owner).PatchAsJsonAsync(url, new { fullName = "Tên cũ", version });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("version_conflict", (await stale.Content.ReadFromJsonAsync<ErrorBody>())!.Error.Code);
        Assert.Equal("Tên mới", (await app.As(t.Owner).GetFromJsonAsync<Envelope<CustomerJson>>(url))!.Data.FullName);
    }

    [Fact]
    public async Task List_runs_the_same_number_of_queries_for_3_or_30_customers()
    {
        var t = await Seed.TenantAsync();
        async Task<int> CommandsForList()
        {
            app.Commands.Reset();
            var page = await app.As(t.Owner).GetFromJsonAsync<ListOf<CustomerJson>>($"/v1/t/{t.Id}/customers?limit=100");
            Assert.All(page!.Data, c => Assert.NotNull(c.NextAppointmentAt));
            return app.Commands.Count;
        }
        async Task AddCustomers(int n)
        {
            for (var i = 0; i < n; i++)
            {
                var c = await app.CustomerAsync(t);
                await app.As(t.Owner).PostAsJsonAsync($"/v1/t/{t.Id}/appointments", new
                {
                    customerId = c, staffUserId = t.Staff,
                    startsAt = new DateTimeOffset(2031, 1, 1, 0, 0, 0, TimeSpan.Zero).AddHours(seq),
                    endsAt = new DateTimeOffset(2031, 1, 1, 0, 30, 0, TimeSpan.Zero).AddHours(seq++),
                });
            }
        }

        await AddCustomers(3);
        var small = await CommandsForList();
        await AddCustomers(27);
        Assert.Equal(small, await CommandsForList());
        Assert.Equal(3, small);   // set_config, membership, the page (next appointment as a subquery)
    }
    int seq;

    [Fact]
    public async Task Per_row_queries_Include_and_projection_differ_in_round_trips()
    {
        var t = await Seed.TenantAsync();
        for (var i = 0; i < 5; i++) await app.CustomerAsync(t);
        await using var scope = app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SpaDb>();
        await using var tx = await Spa.Api.Tenancy.TenantDb.BeginTenantAsync(db, t.Id, default);

        app.Commands.Reset();
        foreach (var c in await db.Customers.ToListAsync())   // N+1: one query per customer
            await db.Appointments.Where(a => a.CustomerId == c.Id).CountAsync();
        Assert.Equal(1 + 5, app.Commands.Count);

        app.Commands.Reset();
        await db.Customers.Include(c => c.Appointments).AsNoTracking().ToListAsync();   // one JOIN, whole appointment rows
        Assert.Equal(1, app.Commands.Count);

        app.Commands.Reset();
        await db.Customers.Select(c => new { c.Id, Count = c.Appointments.Count }).ToListAsync();   // one query, two columns
        Assert.Equal(1, app.Commands.Count);
    }

    [Fact]
    public async Task The_model_matches_the_last_migration()
    {
        await using var scope = app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SpaDb>();
        Assert.False(db.Database.HasPendingModelChanges());              // a model change without `dotnet ef migrations add`
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());     // verify.sh applied them all
    }
}
