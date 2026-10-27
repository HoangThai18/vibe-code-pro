// Spa.Api/Customers/CustomerEndpoints.cs
using Microsoft.EntityFrameworkCore;
using Spa.Api.Data;
using Spa.Api.Http;
using Spa.Api.Tenancy;

namespace Spa.Api.Customers;

public sealed record CustomerDto(Guid Id, string FullName, string Phone, string? Email, DateOnly? Birthday,
    DateTime CreatedAt, uint Version, DateTime? NextAppointmentAt);

public static partial class CustomerEndpoints
{
    public static void MapCustomers(this RouteGroupBuilder t)
    {
        t.MapGet("/customers", List).RequirePermission("customer.read");
        t.MapGet("/customers/{id:guid}", Get).RequirePermission("customer.read");
        t.MapPost("/customers", Create).RequirePermission("customer.write");
        t.MapPatch("/customers/{id:guid}", Update).RequirePermission("customer.write");
        t.MapDelete("/customers/{id:guid}", Delete).RequirePermission("customer.write");
    }

    // A projection: one statement per page, the next appointment as a correlated subquery (no N+1, no Include)
    static IQueryable<CustomerDto> ToDto(this IQueryable<Customer> q, DateTime now) => q.Select(c => new CustomerDto(
        c.Id, c.FullName, c.Phone, c.Email, c.Birthday, c.CreatedAt, c.Version,
        c.Appointments.Where(a => a.StartsAt > now && (a.Status == "booked" || a.Status == "confirmed"))
            .Min(a => (DateTime?)a.StartsAt)));

    static async Task<IResult> List(SpaDb db, int? limit, string? cursor, CancellationToken ct)
    {
        var take = limit ?? 20;
        if (take is < 1 or > 100) throw ApiException.Invalid("limit: 1–100");
        var q = db.Customers.AsQueryable();   // no tenant condition: RLS adds it
        if (cursor is not null)
        {
            var (at, id) = DecodeCursor(cursor);
            // Row value comparison (created_at, id) < (@at, @id): keyset paging on the customers_created index
            q = q.Where(c => EF.Functions.LessThan(ValueTuple.Create(c.CreatedAt, c.Id), ValueTuple.Create(at, id)));
        }
        var rows = await q.OrderByDescending(c => c.CreatedAt).ThenByDescending(c => c.Id)
            .Take(take + 1).ToDto(DateTime.UtcNow).ToListAsync(ct);
        var next = rows.Count > take ? EncodeCursor(rows[take - 1]) : null;
        return Results.Ok(new { data = rows.Take(take), nextCursor = next });
    }
}
