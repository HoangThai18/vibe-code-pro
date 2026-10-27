using System.Net;
using System.Net.Http.Json;
using Spa.Api.Tests.Support;

namespace Spa.Api.Tests;

public sealed class BookingRaceTests(SpaFactory app) : IClassFixture<SpaFactory>
{
    // 100 rounds of 10 concurrent bookings of overlapping slots (10:00-11:00, 10:05-11:05, ...), all released at once
    // just before the booking's first locking statement. Each round: exactly one 201 and nine 409.
    [Fact]
    public async Task Every_round_of_ten_concurrent_bookings_books_exactly_one()
    {
        var t = await Seed.TenantAsync();
        var customer = await app.CustomerAsync(t);
        var client = app.As(t.Owner);
        var url = $"/v1/t/{t.Id}/appointments";
        var bad = new List<string>();
        var deadlocksBefore = app.Barrier.Deadlocks;
        for (var round = 0; round < 100; round++)
        {
            var start = new DateTimeOffset(2032, 1, 1, 0, 0, 0, TimeSpan.Zero).AddHours(3 * round);
            app.Barrier.Arm(10);
            var responses = await Task.WhenAll(Enumerable.Range(0, 10).Select(i => client.PostAsJsonAsync(url, new
            {
                customerId = customer, staffUserId = t.Staff, startsAt = start.AddMinutes(5 * i), endsAt = start.AddMinutes(60 + 5 * i),
            })));
            app.Barrier.Disarm();
            var outcome = new List<string>();
            foreach (var r in responses)
                outcome.Add(r.StatusCode switch
                {
                    HttpStatusCode.Created => "201",
                    HttpStatusCode.InternalServerError => "500",
                    _ => $"{(int)r.StatusCode} {(await r.Content.ReadFromJsonAsync<ErrorBody>())!.Error.Code}",
                });
            if (outcome.Count(o => o == "201") != 1 || outcome.Count(o => o == "409 appointment_slot_taken") != 9)
                bad.Add($"round {round}: " + string.Join(", ", outcome.GroupBy(o => o).Select(g => $"{g.Key} ×{g.Count()}")));
        }
        Assert.True(bad.Count == 0, string.Join("\n", bad));
        Assert.Equal(deadlocksBefore, app.Barrier.Deadlocks);   // a 40P01 mapped to 409 would hide it
    }
}
