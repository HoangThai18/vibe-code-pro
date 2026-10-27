package spa;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import spa.appointments.Appointment;
import spa.appointments.AppointmentRepository;
import spa.support.Api.Res;
import spa.support.ApiTest;
import spa.support.Seed.T;
import spa.web.SqlState;

class DoubleBookingTest extends ApiTest {
    @Autowired
    AppointmentRepository appointments;
    T t;
    UUID customer;

    @BeforeEach
    void seedTenant() {
        t = seed.tenant("Spa A");
        customer = seed.customer(t, "Khách", "0912345678");
    }

    Map<String, Object> slot(UUID staff, String from, String to) {
        return Map.of("customerId", customer, "staffUserId", staff, "startsAt", from, "endsAt", to);
    }

    @Test
    void tenConcurrentBookingsOneWins() throws Exception {
        var start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(10)) {
            List<CompletableFuture<Res>> calls = java.util.stream.IntStream.range(0, 10).mapToObj(i -> CompletableFuture.supplyAsync(() -> {
                await(start);
                // Overlapping, not identical: 10:00-11:00, 10:05-11:05, ...
                return api.post(t.path("/appointments"), t.manager(),
                    slot(t.staff(), "2026-11-02T03:0" + i + ":00Z", "2026-11-02T04:0" + i + ":00Z"));
            }, pool)).toList();
            start.countDown();
            List<Res> results = calls.stream().map(CompletableFuture::join).toList();
            assertThat(results).filteredOn(r -> r.status() == 201).hasSize(1);
            assertThat(results).filteredOn(r -> r.status() == 409).hasSize(9)
                .allSatisfy(r -> assertThat(r.code()).isEqualTo("appointment_slot_taken"));
        }
    }

    @Test
    void hundredRoundsAtTheServiceNeverDeadlock() throws Exception {
        // A barrier right before book(): without lockStaff, 4 of 50 such rounds of bare inserts ended with nobody
        // booked, every request failing with 40P01 (deadlock detected) or 57014 (statement_timeout)
        var manager = new spa.tenant.Tenant(t.id(), t.manager(), spa.auth.Role.MANAGER);
        try (var pool = Executors.newFixedThreadPool(10)) {
            for (int round = 0; round < 100; round++) {
                var barrier = new java.util.concurrent.CyclicBarrier(10);
                Instant day = Instant.parse("2026-12-01T03:00:00Z").plus(round, java.time.temporal.ChronoUnit.DAYS);
                List<CompletableFuture<String>> calls = java.util.stream.IntStream.range(0, 10).mapToObj(i -> CompletableFuture.supplyAsync(() -> {
                    try {
                        barrier.await();
                        spa.tenant.TenantContext.call(manager, () -> booking.book(new spa.appointments.AppointmentDtos.NewAppointment(
                            customer, t.staff(), day.plusSeconds(60L * i), day.plusSeconds(3600 + 60L * i))));
                        return "booked";
                    } catch (spa.web.ApiException e) {
                        return e.code();
                    } catch (Exception e) {
                        return String.valueOf(SqlState.of(e));
                    }
                }, pool)).toList();
                List<String> results = calls.stream().map(CompletableFuture::join).toList();
                assertThat(results).as("round %d", round).containsOnlyOnce("booked")
                    .filteredOn(r -> !r.equals("booked")).hasSize(9).containsOnly("appointment_slot_taken");
            }
        }
    }

    @Autowired
    spa.appointments.AppointmentService booking;

    @Test
    void adjacentSlotAndOtherStaffAreFree() {
        assertThat(api.post(t.path("/appointments"), t.manager(), slot(t.staff(), "2026-11-02T03:00:00Z", "2026-11-02T04:00:00Z")).status()).isEqualTo(201);
        assertThat(api.post(t.path("/appointments"), t.manager(), slot(t.staff(), "2026-11-02T04:00:00Z", "2026-11-02T05:00:00Z")).status()).isEqualTo(201);
        assertThat(api.post(t.path("/appointments"), t.manager(), slot(t.staff2(), "2026-11-02T03:30:00Z", "2026-11-02T04:30:00Z")).status()).isEqualTo(201);
    }

    @Test
    void cancelledAppointmentFreesTheSlot() {
        seed.appointment(t, customer, t.staff(), Instant.parse("2026-11-02T03:00:00Z"), Instant.parse("2026-11-02T04:00:00Z"), "cancelled");
        assertThat(api.post(t.path("/appointments"), t.manager(), slot(t.staff(), "2026-11-02T03:00:00Z", "2026-11-02T04:00:00Z")).status()).isEqualTo(201);
    }

    @Test
    void whatSpringThrowsFor23P01() {
        seed.appointment(t, customer, t.staff(), Instant.parse("2026-11-02T03:00:00Z"), Instant.parse("2026-11-02T04:00:00Z"), "booked");
        Throwable thrown = catchThrowable(() -> seed.inTenant(t.id(), () -> appointments.saveAndFlush(new Appointment(
            t.id(), customer, t.staff(), Instant.parse("2026-11-02T03:30:00Z"), Instant.parse("2026-11-02T04:30:00Z")))));
        // Spring's DataIntegrityViolationException (not a subclass) → Hibernate's ConstraintViolationException → PSQLException
        assertThat(thrown).isExactlyInstanceOf(DataIntegrityViolationException.class);
        assertThat(thrown.getCause()).isInstanceOf(ConstraintViolationException.class);
        assertThat(((ConstraintViolationException) thrown.getCause()).getConstraintName()).isNull();   // not extracted for 23P01
        var psql = (org.postgresql.util.PSQLException) thrown.getCause().getCause();
        assertThat(psql.getServerErrorMessage().getConstraint()).isEqualTo("appointments_no_overlap");
        assertThat(SqlState.of(thrown)).isEqualTo("23P01");
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await();
        } catch (InterruptedException e) {
            throw new IllegalStateException(e);
        }
    }
}
