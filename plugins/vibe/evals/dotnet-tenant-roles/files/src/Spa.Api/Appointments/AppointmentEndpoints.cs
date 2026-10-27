using Spa.Api.Data;

namespace Spa.Api.Appointments;

public record BookAppointment(Guid CustomerId, Guid StaffUserId, DateTimeOffset StartsAt, DateTimeOffset EndsAt);

public static class AppointmentEndpoints
{
    public static void MapAppointments(this RouteGroupBuilder t) =>
        t.MapPost("/appointments", async (Guid tenantId, BookAppointment body, SpaDb db) =>
        {
            var a = new Appointment
            {
                TenantId = tenantId, Id = Guid.CreateVersion7(), CustomerId = body.CustomerId, StaffUserId = body.StaffUserId,
                StartsAt = body.StartsAt.UtcDateTime, EndsAt = body.EndsAt.UtcDateTime,
            };
            db.Appointments.Add(a);
            await db.SaveChangesAsync();
            return Results.Created($"/v1/t/{tenantId}/appointments/{a.Id}", new { data = a });
        });
}
