using Microsoft.EntityFrameworkCore;
using Spa.Api.Data;

namespace Spa.Api.Customers;

public static class CustomerEndpoints
{
    public static void MapCustomerEndpoints(this WebApplication app)
    {
        var g = app.MapGroup("/v1/t/{tenantId:guid}/customers").RequireAuthorization();

        g.MapGet("/", async (AppDbContext db) =>
            Results.Ok(new { data = await db.Customers.OrderBy(c => c.FullName).Take(50).ToListAsync() }));

        // Trash: soft-deleted customers, so staff can restore them
        g.MapGet("/deleted", async (AppDbContext db) =>
            Results.Ok(new
            {
                data = await db.Customers.IgnoreQueryFilters()
                    .Where(c => c.DeletedAt != null).OrderByDescending(c => c.DeletedAt).Take(50).ToListAsync(),
            }));

        g.MapPost("/{id:guid}/restore", async (Guid id, AppDbContext db) =>
        {
            var c = await db.Customers.IgnoreQueryFilters().FirstOrDefaultAsync(x => x.Id == id);
            if (c is null) return Results.NotFound();
            c.DeletedAt = null;
            await db.SaveChangesAsync();
            return Results.Ok(new { data = c });
        });

        g.MapDelete("/{id:guid}", async (Guid id, AppDbContext db) =>
        {
            var c = await db.Customers.FirstOrDefaultAsync(x => x.Id == id);
            if (c is null) return Results.NotFound();
            c.DeletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }
}
