package vn.spa.crm.appointment;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AppointmentRepository extends JpaRepository<Appointment, UUID> {
    List<Appointment> findByStartsAtBetweenOrderByStartsAt(Instant from, Instant to);
}
