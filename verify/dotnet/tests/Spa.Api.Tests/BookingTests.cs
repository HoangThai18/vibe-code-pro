using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Spa.Api.Data;
using Spa.Api.Tenancy;
using Spa.Api.Tests.Support;

namespace Spa.Api.Tests;

public sealed class BookingTests(SpaFactory app) : IClassFixture<SpaFactory>
{
    [Fact]
    public async Task Back_to_back_slots_and_other_staff_are_free()
    {
        var t = await Seed.TenantAsync();
        var customer = await app.CustomerAsync(t);
        Task<HttpResponseMessage> Book(Guid staff, string from, string to) => app.As(t.Owner).PostAsJsonAsync(
            $"/v1/t/{t.Id}/appointments", new { customerId = customer, staffUserId = staff, startsAt = from, endsAt = to });

        Assert.Equal(HttpStatusCode.Created, (await Book(t.Staff, "2030-11-04T03:00:00Z", "2030-11-04T04:00:00Z")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Book(t.Staff, "2030-11-04T04:00:00Z", "2030-11-04T05:00:00Z")).StatusCode);   // [start, end)
        Assert.Equal(HttpStatusCode.Created, (await Book(t.Staff2, "2030-11-04T03:30:00Z", "2030-11-04T04:30:00Z")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Book(t.Staff, "2030-11-04T03:30:00+07:00", "2030-11-04T11:30:00+07:00")).StatusCode);
    }

    [Fact]
    public async Task A_customer_with_appointments_is_not_deleted()
    {
        var t = await Seed.TenantAsync();
        var customer = await app.CustomerAsync(t);
        await app.As(t.Owner).PostAsJsonAsync($"/v1/t/{t.Id}/appointments",
            new { customerId = customer, staffUserId = t.Staff, startsAt = "2030-11-05T03:00:00Z", endsAt = "2030-11-05T04:00:00Z" });
        var res = await app.As(t.Owner).DeleteAsync($"/v1/t/{t.Id}/customers/{customer}");
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);   // ExecuteDelete throws PostgresException 23503, unwrapped
        Assert.Equal("customer_has_appointments", (await res.Content.ReadFromJsonAsync<ErrorBody>())!.Error.Code);
    }

    [Fact]
    public async Task Npgsql_writes_only_UTC_DateTime_to_timestamptz()
    {
        var t = await Seed.TenantAsync();
        var customer = await app.CustomerAsync(t);
        await using var db = new SpaDb(new DbContextOptionsBuilder<SpaDb>().UseNpgsql(Db.AppCs).UseSnakeCaseNamingConvention().Options);
        await using var tx = await db.BeginTenantAsync(t.Id, default);
        db.Appointments.Add(new Appointment
        {
            TenantId = t.Id, Id = Guid.CreateVersion7(), CustomerId = customer, StaffUserId = t.Staff,
            StartsAt = new DateTime(2030, 11, 6, 10, 0, 0, DateTimeKind.Local), EndsAt = new DateTime(2030, 11, 6, 11, 0, 0, DateTimeKind.Local),
        });
        var e = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());   // e.g. DateTime.Now
        Assert.Contains("only UTC is supported", Assert.IsType<ArgumentException>(e.InnerException).Message);
    }
}
