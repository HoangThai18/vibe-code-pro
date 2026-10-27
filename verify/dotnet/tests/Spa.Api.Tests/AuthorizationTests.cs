using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Spa.Api.Tenancy;
using Spa.Api.Tests.Support;

namespace Spa.Api.Tests;

public sealed class AuthorizationTests(SpaFactory app) : IClassFixture<SpaFactory>
{
    // auth.md section 4: a new permission is a new row
    [Theory]
    [InlineData("owner", "billing.manage", true)]
    [InlineData("owner", "api_key.manage", true)]
    [InlineData("manager", "appointment.confirm", true)]
    [InlineData("manager", "customer.import", true)]
    [InlineData("manager", "member.role_change", true)]
    [InlineData("manager", "billing.manage", false)]
    [InlineData("manager", "api_key.manage", false)]
    [InlineData("staff", "customer.read", true)]
    [InlineData("staff", "customer.write", false)]
    [InlineData("staff", "customer.import", false)]
    [InlineData("staff", "appointment.write", true)]
    [InlineData("staff", "appointment.confirm", false)]
    [InlineData("staff", "member.role_change", false)]
    [InlineData("intern", "customer.read", false)]   // a role missing from the table is denied
    public void Permission_matrix(string role, string action, bool expected) =>
        Assert.Equal(expected, Permissions.Can(role, action));

    [Fact]
    public async Task Http_status_by_role_and_membership()
    {
        var (t, other) = (await Seed.TenantAsync(), await Seed.TenantAsync());
        var customers = $"/v1/t/{t.Id}/customers";
        var body = new { fullName = "Lê Văn An", phone = Seed.NewPhone() };

        Assert.Equal(HttpStatusCode.Unauthorized, (await app.CreateClient().GetAsync(customers)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await app.As(other.Owner).GetAsync(customers)).StatusCode);    // not a member
        Assert.Equal(HttpStatusCode.NotFound, (await app.As(t.Owner).GetAsync("/v1/t/not-a-uuid/customers")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await app.As(t.Owner).GetAsync($"/v1/t/{Guid.NewGuid()}/customers")).StatusCode);

        var staffPost = await app.As(t.Staff).PostAsJsonAsync(customers, body);
        Assert.Equal(HttpStatusCode.Forbidden, staffPost.StatusCode);                                       // member, no permission
        Assert.Equal("forbidden", (await staffPost.Content.ReadFromJsonAsync<ErrorBody>())!.Error.Code);
        Assert.Equal(HttpStatusCode.OK, (await app.As(t.Staff).GetAsync(customers)).StatusCode);            // customer.read
        Assert.Equal(HttpStatusCode.Created, (await app.As(t.Manager).PostAsJsonAsync(customers, body)).StatusCode);
    }

    [Fact]
    public async Task Staff_book_only_for_themselves()
    {
        var t = await Seed.TenantAsync();
        var customer = await app.CustomerAsync(t);
        Task<HttpResponseMessage> Book(Guid by, Guid staff, int hour) => app.As(by).PostAsJsonAsync($"/v1/t/{t.Id}/appointments",
            new { customerId = customer, staffUserId = staff, startsAt = $"2030-12-01T{hour:00}:00:00Z", endsAt = $"2030-12-01T{hour + 1:00}:00:00Z" });

        Assert.Equal(HttpStatusCode.Forbidden, (await Book(t.Staff, t.Staff2, 1)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Book(t.Staff, t.Staff, 2)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Book(t.Manager, t.Staff2, 3)).StatusCode);   // managers book for anyone
    }

    // Why the permission is checked in TenantFilter: a RequireAuthorization("customer.write") policy runs first,
    // before any endpoint filter has loaded the membership
    [Fact]
    public async Task Authorization_policies_run_before_endpoint_filters()
    {
        var order = new List<string>();
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddAuthentication(TestAuth.SchemeName).AddScheme<AuthenticationSchemeOptions, TestAuth>(TestAuth.SchemeName, null);
        builder.Services.AddAuthorization(o => o.AddPolicy("customer.write", p => p.RequireAssertion(_ => { order.Add("policy"); return true; })));
        await using var web = builder.Build();
        web.MapGet("/x", () => { order.Add("handler"); return "ok"; })
            .RequireAuthorization("customer.write")
            .AddEndpointFilter(async (ctx, next) => { order.Add("filter"); return await next(ctx); });
        await web.StartAsync();
        var client = web.GetTestClient();
        client.DefaultRequestHeaders.Add(TestAuth.Header, Guid.NewGuid().ToString());

        await client.GetStringAsync("/x");
        Assert.Equal(["policy", "filter", "handler"], order);
    }

    [Fact]
    public void Every_tenant_endpoint_declares_a_permission()
    {
        var tenantEndpoints = app.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText!.StartsWith("/v1/t/")).ToList();
        Assert.NotEmpty(tenantEndpoints);
        Assert.All(tenantEndpoints, e => Assert.NotNull(e.Metadata.GetMetadata<PermissionRequirement>()));
    }
}
