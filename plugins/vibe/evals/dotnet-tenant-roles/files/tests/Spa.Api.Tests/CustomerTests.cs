using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Spa.Api.Tests;

// Runs against the test database (DATABASE_URL), connected as app_user
public class CustomerTests(WebApplicationFactory<Program> app) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Anonymous_requests_are_401()
    {
        var res = await app.CreateClient().GetAsync($"/v1/t/{Guid.NewGuid()}/customers");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }
}
