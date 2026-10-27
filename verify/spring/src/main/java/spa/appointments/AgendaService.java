package spa.appointments;

import java.time.Instant;
import org.springframework.data.domain.Limit;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import spa.appointments.AppointmentDtos.Agenda;
import spa.appointments.AppointmentDtos.AgendaItem;

@Service
public class AgendaService {
    private final AppointmentRepository appointments;

    AgendaService(AppointmentRepository appointments) {
        this.appointments = appointments;
    }

    @PreAuthorize("@authz.can('customer.read')")
    @Transactional(readOnly = true)
    public Agenda between(Instant from, Instant to, int limit) {
        return new Agenda(appointments.findBetween(from, to, Limit.of(Math.clamp(limit, 1, 100)))
            .stream().map(AgendaItem::of).toList());
    }
}
