package spa.appointments;

import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class AppointmentDtos {
    private AppointmentDtos() {}

    public record NewAppointment(@NotNull UUID customerId, @NotNull UUID staffUserId,
                                 @NotNull Instant startsAt, @NotNull Instant endsAt) {}

    public record AppointmentDto(UUID id, UUID customerId, UUID staffUserId, Instant startsAt, Instant endsAt) {
        static AppointmentDto of(Appointment a) {
            return new AppointmentDto(a.getId(), a.getCustomerId(), a.getStaffUserId(), a.getStartsAt(), a.getEndsAt());
        }
    }

    public record AgendaItem(UUID id, Instant startsAt, Instant endsAt, UUID staffUserId, String customerName) {
        static AgendaItem of(Appointment a) {
            return new AgendaItem(a.getId(), a.getStartsAt(), a.getEndsAt(), a.getStaffUserId(), a.getCustomer().getFullName());
        }
    }

    public record Agenda(List<AgendaItem> data) {}
}
