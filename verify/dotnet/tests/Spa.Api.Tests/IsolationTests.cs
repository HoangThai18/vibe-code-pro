using System.Net;
using System.Net.Http.Json;
using Spa.Api.Tests.Support;

namespace Spa.Api.Tests;

// isolation-tests.md: two tenants, both attack paths, a positive control for every negative check
public sealed class IsolationTests(SpaFactory app) : IClassFixture<SpaFactory>
{
    public sealed record Route(string Name, HttpMethod Method, Func<Guid, Guid, string> Path, object? Body = null)
    {
        public override string ToString() => Name;
    }

    // One row per route with a tenant resource :id
    public static TheoryData<Route> CrossTenantRoutes =>
    [
        new Route("GET customers/:id", HttpMethod.Get, (t, id) => $"/v1/t/{t}/customers/{id}"),
        new Route("PATCH customers/:id", HttpMethod.Patch, (t, id) => $"/v1/t/{t}/customers/{id}", new { fullName = "hack" }),
        new Route("DELETE customers/:id", HttpMethod.Delete, (t, id) => $"/v1/t/{t}/customers/{id}"),
    ];

    Task<HttpResponseMessage> Call(Route r, Guid tenant, Guid id, Guid user) =>
        app.As(user).SendAsync(new HttpRequestMessage(r.Method, r.Path(tenant, id))
        {
            Content = r.Body is null ? null : JsonContent.Create(r.Body),
        });

    [Theory]
    [MemberData(nameof(CrossTenantRoutes))]
    public async Task Tenant_A_cannot_touch_tenant_B_data(Route route)
    {
        var (a, b) = (await Seed.TenantAsync("A"), await Seed.TenantAsync("B"));
        var bCustomer = await app.CustomerAsync(b, "Khách của B");

        // 1. B's id in A's path: RLS hides the row. 2. B's path: A is not a member.
        Assert.Equal(HttpStatusCode.NotFound, (await Call(route, a.Id, bCustomer, a.Owner)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Call(route, b.Id, bCustomer, a.Owner)).StatusCode);

        // B's data is unchanged
        var fromB = await app.As(b.Owner).GetFromJsonAsync<Envelope<NameOnly>>($"/v1/t/{b.Id}/customers/{bCustomer}");
        Assert.Equal("Khách của B", fromB!.Data.FullName);

        // Control: B making the same request succeeds (a wrong route would also return 404)
        Assert.True((await Call(route, b.Id, bCustomer, b.Owner)).IsSuccessStatusCode);
    }

    [Fact]
    public async Task List_has_own_rows_only_and_another_tenants_list_is_404()
    {
        var (a, b) = (await Seed.TenantAsync("A"), await Seed.TenantAsync("B"));
        var aCustomer = await app.CustomerAsync(a);
        var bCustomer = await app.CustomerAsync(b);

        var list = await app.As(a.Owner).GetFromJsonAsync<ListOf<IdOnly>>($"/v1/t/{a.Id}/customers?limit=100");
        var ids = list!.Data.Select(c => c.Id).ToList();
        Assert.Contains(aCustomer, ids);   // control: an empty list fails here
        Assert.DoesNotContain(bCustomer, ids);

        Assert.Equal(HttpStatusCode.NotFound, (await app.As(a.Owner).GetAsync($"/v1/t/{b.Id}/customers")).StatusCode);
    }

    [Fact]
    public async Task TenantId_in_the_body_is_ignored()
    {
        var (a, b) = (await Seed.TenantAsync("A"), await Seed.TenantAsync("B"));
        var res = await app.As(a.Owner).PostAsJsonAsync($"/v1/t/{a.Id}/customers",
            new { fullName = "Tạo lậu", phone = Seed.NewPhone(), tenantId = b.Id });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var id = (await res.Content.ReadFromJsonAsync<Envelope<IdOnly>>())!.Data.Id;
        Assert.Equal(HttpStatusCode.OK, (await app.As(a.Owner).GetAsync($"/v1/t/{a.Id}/customers/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await app.As(b.Owner).GetAsync($"/v1/t/{b.Id}/customers/{id}")).StatusCode);
    }

    [Fact]
    public async Task Cannot_book_with_another_tenants_customer()
    {
        var (a, b) = (await Seed.TenantAsync("A"), await Seed.TenantAsync("B"));
        var aCustomer = await app.CustomerAsync(a);
        var bCustomer = await app.CustomerAsync(b);
        var slot = new { staffUserId = a.Staff, startsAt = "2030-11-02T03:00:00Z", endsAt = "2030-11-02T04:00:00Z" };

        var cross = await app.As(a.Owner).PostAsJsonAsync($"/v1/t/{a.Id}/appointments", new { customerId = bCustomer, slot.staffUserId, slot.startsAt, slot.endsAt });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, cross.StatusCode);   // composite FK: 23503
        Assert.Equal("invalid_reference", (await cross.Content.ReadFromJsonAsync<ErrorBody>())!.Error.Code);

        var own = await app.As(a.Owner).PostAsJsonAsync($"/v1/t/{a.Id}/appointments", new { customerId = aCustomer, slot.staffUserId, slot.startsAt, slot.endsAt });
        Assert.Equal(HttpStatusCode.Created, own.StatusCode);
    }
}

public sealed record NameOnly(Guid Id, string FullName);
public sealed record ListOf<T>(List<T> Data, string? NextCursor);
