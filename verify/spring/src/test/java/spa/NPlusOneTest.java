package spa;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Limit;
import spa.appointments.Appointment;
import spa.appointments.AppointmentRepository;
import spa.support.ApiTest;
import spa.support.Seed.T;

class NPlusOneTest extends ApiTest {
    static final Instant DAY = Instant.parse("2026-11-02T00:00:00Z");
    @Autowired
    AppointmentRepository appointments;
    @Autowired
    EntityManager em;   // the shared, transaction-bound proxy
    @Autowired
    EntityManagerFactory emf;
    T t;

    @BeforeEach
    void tenAppointmentsOfTenCustomers() {
        t = seed.tenant("Spa A");
        for (int i = 0; i < 10; i++) {
            var c = seed.customer(t, "Khách " + i, "09000000%02d".formatted(i));
            seed.appointment(t, c, t.staff(), DAY.plus(i, ChronoUnit.HOURS), DAY.plus(i, ChronoUnit.HOURS).plusSeconds(1800), "booked");
        }
    }

    long statementsFor(Runnable work) {
        Statistics stats = emf.unwrap(SessionFactory.class).getStatistics();
        stats.clear();
        seed.inTenant(t.id(), () -> { work.run(); return null; });
        return stats.getPrepareStatementCount();   // includes the set_config at the start of the transaction
    }

    @Test
    void lazyCustomerInTheListIsNPlusOne() {
        long n = statementsFor(() -> em.createQuery(
                "SELECT a FROM Appointment a WHERE a.startsAt >= :from ORDER BY a.startsAt", Appointment.class)
            .setParameter("from", DAY).getResultList()
            .forEach(a -> a.getCustomer().getFullName()));                // one SELECT per customer
        assertThat(n).isEqualTo(1 + 1 + 10);
    }

    @Test
    void joinFetchIsOneQuery() {
        long n = statementsFor(() -> appointments.findBetween(DAY, DAY.plus(1, ChronoUnit.DAYS), Limit.of(100))
            .forEach(a -> a.getCustomer().getFullName()));
        assertThat(n).isEqualTo(1 + 1);
    }

    @Test
    void agendaEndpointReturnsNames() {
        List<String> names = api.get(t.path("/appointments?from=2026-11-02T00:00:00Z&to=2026-11-03T00:00:00Z"), t.staff())
            .body().path("data").valueStream().map(i -> i.path("customerName").asString()).toList();
        assertThat(names).hasSize(10).first().isEqualTo("Khách 0");
    }
}
