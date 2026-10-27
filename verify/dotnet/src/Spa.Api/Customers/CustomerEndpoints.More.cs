using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Spa.Api.Data;
using Spa.Api.Http;
using Spa.Api.Tenancy;

namespace Spa.Api.Customers;

public sealed record CreateCustomer(string FullName, string Phone, string? Email, DateOnly? Birthday);
public sealed record UpdateCustomer(string? FullName, string? Phone, uint? Version);

public static partial class CustomerEndpoints
{
    static async Task<IResult> Get(SpaDb db, Guid id, CancellationToken ct) =>
        await db.Customers.Where(c => c.Id == id).ToDto(DateTime.UtcNow).SingleOrDefaultAsync(ct) is { } dto
            ? Results.Ok(new { data = dto })
            : throw ApiException.NotFound();   // another tenant's id: RLS hides the row

    static async Task<IResult> Create(SpaDb db, RequestTenant t, CreateCustomer body, CancellationToken ct)
    {
        var c = new Customer
        {
            TenantId = t.Member.TenantId,   // from the membership-checked path, never the body
            Id = Guid.CreateVersion7(),
            FullName = Name(body.FullName),
            Phone = Phone(body.Phone),
            Email = body.Email,
            Birthday = body.Birthday,
        };
        db.Customers.Add(c);
        await SaveAsync(db, ct);
        return Results.Created($"/v1/t/{c.TenantId}/customers/{c.Id}", new { data = ToDto(c) });
    }

    static async Task<IResult> Update(SpaDb db, Guid id, UpdateCustomer body, CancellationToken ct)
    {
        var c = await db.Customers.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw ApiException.NotFound();
        // Optimistic concurrency: the UPDATE gets "AND xmin = @version"; 0 rows → DbUpdateConcurrencyException
        if (body.Version is { } version) db.Entry(c).Property(x => x.Version).OriginalValue = version;
        if (body.FullName is not null) c.FullName = Name(body.FullName);
        if (body.Phone is not null) c.Phone = Phone(body.Phone);
        await SaveAsync(db, ct);   // DbUpdateConcurrencyException → 409 version_conflict, 23505 → customer_phone_taken
        return Results.Ok(new { data = ToDto(c) });
    }

    static async Task<IResult> Delete(SpaDb db, Guid id, CancellationToken ct)
    {
        try
        {
            return await db.Customers.Where(c => c.Id == id).ExecuteDeleteAsync(ct) == 1
                ? Results.NoContent()
                : throw ApiException.NotFound();
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.ForeignKeyViolation)   // not wrapped: ExecuteDelete
        {
            throw new ApiException(409, "customer_has_appointments", "Khách hàng đã có lịch hẹn.");
        }
    }

    static async Task SaveAsync(SpaDb db, CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ApiException(409, "version_conflict", "Khách hàng vừa được người khác sửa, hãy tải lại.");
        }
        catch (DbUpdateException e) when (e.SqlState() == PostgresErrorCodes.UniqueViolation)   // 23505
        {
            throw new ApiException(409, "customer_phone_taken", "Số điện thoại này đã có trong spa.");
        }
    }

    static CustomerDto ToDto(Customer c) =>
        new(c.Id, c.FullName, c.Phone, c.Email, c.Birthday, c.CreatedAt, c.Version, null);

    static string Name(string s)
    {
        var name = s.Normalize(NormalizationForm.FormC).Trim();
        return name.Length is >= 1 and <= 200 ? name : throw ApiException.Invalid("fullName: 1–200 ký tự");
    }

    // Stored as 0912345678 (the normalizer of data-import.md)
    static string Phone(string s)
    {
        var d = Separators().Replace(s, "");
        if (d.StartsWith("+84")) d = "0" + d[3..];
        else if (Intl().IsMatch(d)) d = "0" + d[2..];
        else if (NoLeadingZero().IsMatch(d)) d = "0" + d;
        return Valid().IsMatch(d) ? d : throw ApiException.Invalid("phone: ví dụ 0912345678");
    }

    // Opaque cursor: base64url of "created_at ticks:id"; PostgreSQL keeps microseconds, so the ticks round-trip
    static string EncodeCursor(CustomerDto c) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes($"{c.CreatedAt.Ticks}:{c.Id}")).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    static (DateTime, Guid) DecodeCursor(string cursor)
    {
        try
        {
            var s = cursor.Replace('-', '+').Replace('_', '/');
            var parts = Encoding.UTF8.GetString(Convert.FromBase64String(s.PadRight(s.Length + (4 - s.Length % 4) % 4, '='))).Split(':');
            return (new DateTime(long.Parse(parts[0]), DateTimeKind.Utc), Guid.Parse(parts[1]));
        }
        catch (Exception e) when (e is FormatException or IndexOutOfRangeException or ArgumentOutOfRangeException)
        {
            throw ApiException.Invalid("cursor");
        }
    }

    [GeneratedRegex(@"[\s.\-()]")] private static partial Regex Separators();
    [GeneratedRegex(@"^84\d{9,10}$")] private static partial Regex Intl();
    [GeneratedRegex(@"^[1-9]\d{8,9}$")] private static partial Regex NoLeadingZero();
    [GeneratedRegex(@"^0\d{9,10}$")] private static partial Regex Valid();
}
