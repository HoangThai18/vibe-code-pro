// Spa.Api/Appointments/AppointmentEndpoints.cs
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Spa.Api.Data;
using Spa.Api.Http;
using Spa.Api.Tenancy;

namespace Spa.Api.Appointments;

public sealed record BookAppointment(Guid CustomerId, Guid StaffUserId, DateTimeOffset StartsAt, DateTimeOffset EndsAt);

public static class AppointmentEndpoints
{
    public static void MapAppointments(this RouteGroupBuilder t) =>
        t.MapPost("/appointments", Book).RequirePermission("appointment.write");

    static async Task<IResult> Book(SpaDb db, RequestTenant t, BookAppointment body, CancellationToken ct)
    {
        var m = t.Member;
        // Per-record rule (auth.md section 5): staff book only for themselves
        if (m.Role == "staff" && body.StaffUserId != m.UserId) throw ApiException.Forbidden("appointment.write");
        if (body.EndsAt <= body.StartsAt) throw ApiException.Invalid("endsAt > startsAt");
        var a = new Appointment
        {
            TenantId = m.TenantId, Id = Guid.CreateVersion7(), CustomerId = body.CustomerId, StaffUserId = body.StaffUserId,
            StartsAt = body.StartsAt.UtcDateTime, EndsAt = body.EndsAt.UtcDateTime,
        };
        db.Appointments.Add(a);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException e) when (e.SqlState() == PostgresErrorCodes.ExclusionViolation)   // 23P01
        {
            // appointments_no_overlap (data-layer.md section 6): also under concurrency
            throw new ApiException(409, "appointment_slot_taken", "Khung giờ này đã có lịch.");
        }
        catch (DbUpdateException e) when (e.SqlState() == PostgresErrorCodes.ForeignKeyViolation)  // 23503
        {
            // Customer or staff not in this tenant (composite FKs); don't echo the DB message
            throw new ApiException(422, "invalid_reference", "Khách hàng hoặc nhân viên không hợp lệ.");
        }
        return Results.Created($"/v1/t/{m.TenantId}/appointments/{a.Id}",
            new { data = new { a.Id, a.CustomerId, a.StaffUserId, a.StartsAt, a.EndsAt, a.Status } });
    }
}
