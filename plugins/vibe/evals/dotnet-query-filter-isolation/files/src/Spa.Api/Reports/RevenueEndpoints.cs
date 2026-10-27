using Microsoft.EntityFrameworkCore;
using Spa.Api.Data;

namespace Spa.Api.Reports;

public record RevenueRow(DateTime Month, long Total);

public static class RevenueEndpoints
{
    public static void MapRevenueEndpoints(this WebApplication app) =>
        app.MapGet("/v1/t/{tenantId:guid}/reports/revenue", async (AppDbContext db) =>
        {
            // LINQ GroupBy on date_trunc was awkward, so plain SQL
            var rows = await db.Database.SqlQuery<RevenueRow>($"""
                SELECT date_trunc('month', "StartsAt") AS "Month", sum("Price")::bigint AS "Total"
                  FROM appointments
                 WHERE "Status" = 'done'
                 GROUP BY 1 ORDER BY 1
                """).ToListAsync();
            return Results.Ok(new { data = rows });
        }).RequireAuthorization();
}
