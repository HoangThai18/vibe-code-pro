package spa.appointments;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface AppointmentRepository extends JpaRepository<Appointment, UUID> {
    // join fetch: customers come in the same query (without it: 1 query + 1 per appointment)
    @Query("""
        SELECT a FROM Appointment a JOIN FETCH a.customer
         WHERE a.startsAt >= :from AND a.startsAt < :to
         ORDER BY a.startsAt, a.id""")
    List<Appointment> findBetween(Instant from, Instant to, Limit limit);

    // Until commit: concurrent bookings of one staff member wait here, then fail cleanly with 23P01
    @Query(value = "SELECT count(*) FROM pg_advisory_xact_lock(hashtextextended(CAST(:tenantId AS text) || CAST(:staffUserId AS text), 0))",
        nativeQuery = true)
    long lockStaff(UUID tenantId, UUID staffUserId);
}
