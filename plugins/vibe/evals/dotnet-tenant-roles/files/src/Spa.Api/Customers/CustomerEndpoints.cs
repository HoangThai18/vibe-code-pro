using Microsoft.EntityFrameworkCore;
using Spa.Api.Data;

namespace Spa.Api.Customers;

public record CreateCustomer(string FullName, string Phone);

public static class CustomerEndpoints
{
    public static void MapCustomers(this RouteGroupBuilder t)
    {
        t.MapGet("/customers", async (SpaDb db) =>
            Results.Ok(new { data = await db.Customers.OrderBy(c => c.FullName).Take(50).ToListAsync() }));

        t.MapPost("/customers", async (Guid tenantId, CreateCustomer body, SpaDb db) =>
        {
            var c = new Customer { TenantId = tenantId, Id = Guid.CreateVersion7(), FullName = body.FullName, Phone = body.Phone };
            db.Customers.Add(c);
            await db.SaveChangesAsync();
            return Results.Created($"/v1/t/{tenantId}/customers/{c.Id}", new { data = c });
        });
    }
}
