using System.Net;
using System.Net.Http.Json;
using Spa.Api.Tests.Support;

namespace Spa.Api.Tests;

public sealed class BookingRaceTests(SpaFactory app) : IClassFixture<SpaFactory>
{
    [Fact]
    public async Task Ten_concurrent_bookings_of_one_slot_one_wins_nine_get_409()
    {
        var t = await Seed.TenantAsync();
        var customer = await app.CustomerAsync(t);
        var url = $"/v1/t/{t.Id}/appointments";

        // Overlapping, not identical: 10:00-11:00, 10:05-11:05, ... (a UNIQUE on starts_at would let all of them in)
        var responses = await Task.WhenAll(Enumerable.Range(0, 10).Select(i => app.As(t.Owner).PostAsJsonAsync(url, new
        {
            customerId = customer, staffUserId = t.Staff,
            startsAt = new DateTimeOffset(2030, 11, 3, 3, 0, 0, TimeSpan.Zero).AddMinutes(5 * i),
            endsAt = new DateTimeOffset(2030, 11, 3, 4, 0, 0, TimeSpan.Zero).AddMinutes(5 * i),
        })));

        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Created);
        var conflicts = responses.Where(r => r.StatusCode == HttpStatusCode.Conflict).ToList();
        Assert.Equal(9, conflicts.Count);
        foreach (var r in conflicts)
            Assert.Equal("appointment_slot_taken", (await r.Content.ReadFromJsonAsync<ErrorBody>())!.Error.Code);
    }
}
