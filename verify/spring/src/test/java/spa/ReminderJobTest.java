package spa;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import spa.reminders.ReminderJob;
import spa.support.ApiTest;
import spa.support.FakeSender;
import spa.support.Seed.T;

class ReminderJobTest extends ApiTest {
    @Autowired
    ReminderJob job;
    @Autowired
    FakeSender sender;
    @Autowired
    JdbcTemplate jdbc;
    T a;
    T b;
    UUID dueInA;
    UUID dueInB;

    @BeforeEach
    void seedAppointments() {
        sender.reset();
        a = seed.tenant("Spa A");
        b = seed.tenant("Spa B");
        T suspended = seed.tenant("Spa C", "suspended");
        Instant now = Instant.now();
        UUID ca = seed.customer(a, "Nguyễn Thị Đào", "0912345678");
        UUID cb = seed.customer(b, "Trần Văn B", "0987654321");
        UUID cc = seed.customer(suspended, "Khách C", "0911111111");
        seed.appointment(a, ca, a.staff(), now.plus(1, ChronoUnit.HOURS), now.plus(2, ChronoUnit.HOURS), "booked");     // too soon
        dueInA = seed.appointment(a, ca, a.staff(), now.plus(10, ChronoUnit.HOURS), now.plus(11, ChronoUnit.HOURS), "booked");
        seed.appointment(a, ca, a.staff(), now.plus(30, ChronoUnit.HOURS), now.plus(31, ChronoUnit.HOURS), "booked");   // too late
        seed.appointment(a, ca, a.staff2(), now.plus(12, ChronoUnit.HOURS), now.plus(13, ChronoUnit.HOURS), "cancelled");
        dueInB = seed.appointment(b, cb, b.staff(), now.plus(5, ChronoUnit.HOURS), now.plus(6, ChronoUnit.HOURS), "confirmed");
        seed.appointment(suspended, cc, suspended.staff(), now.plus(10, ChronoUnit.HOURS), now.plus(11, ChronoUnit.HOURS), "booked");
    }

    @Test
    void theAppRoleSeesNoTenantsWithoutContextButAppTenantIdsDoes() {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM tenants", Long.class)).isZero();
        assertThat(jdbc.queryForList("SELECT id FROM app_tenant_ids() AS id", UUID.class)).containsExactlyInAnyOrder(a.id(), b.id());
    }

    @Test
    void remindsOncePerAppointmentInActiveTenants() {
        assertThat(job.runOnce()).isEqualTo(2);
        assertThat(sender.sent).extracting(FakeSender.Sent::phone).containsExactlyInAnyOrder("0912345678", "0987654321");
        assertThat(job.runOnce()).isZero();   // a rerun sends nothing
        assertThat(sender.sent).hasSize(2);
        assertThat(notificationIdOf(a, dueInA)).isEqualTo(keyOf("0912345678"));   // idempotency key = notification id
    }

    @Test
    void textIsUnaccentedInTheTenantsTimeZone() {
        job.runOnce();
        String text = sender.sent.stream().filter(s -> s.phone().equals("0912345678")).findFirst().orElseThrow().text();
        assertThat(text).startsWith("Chao Nguyen Thi Dao, nhac lich hen cua ban luc ").matches("\\p{ASCII}+");
        Instant startsAt = seed.inTenant(a.id(), () -> jdbc.queryForObject(
            "SELECT starts_at FROM appointments WHERE id = ?", java.sql.Timestamp.class, dueInA).toInstant());
        String local = java.time.format.DateTimeFormatter.ofPattern("HH:mm dd/MM/yyyy")
            .withZone(java.time.ZoneId.of("Asia/Ho_Chi_Minh")).format(startsAt);
        assertThat(text).endsWith(local + ".");
    }

    @Test
    void aSecondInstanceSkipsWhileTheFirstRuns() throws Exception {
        sender.entered = new CountDownLatch(1);
        sender.release = new CountDownLatch(1);
        CompletableFuture<Integer> first = CompletableFuture.supplyAsync(job::runOnce);
        assertThat(sender.entered.await(10, TimeUnit.SECONDS)).isTrue();   // the first run is inside send()
        int second = job.runOnce();                                         // another instance, same database
        sender.release.countDown();
        assertThat(second).isEqualTo(-1);
        assertThat(first.get(10, TimeUnit.SECONDS)).isEqualTo(2);
        assertThat(sender.sent).extracting(FakeSender.Sent::idempotencyKey).doesNotHaveDuplicates().hasSize(2);
    }

    @Test
    void aFailedSendStaysPendingForTheNextRun() {
        sender.failNext.set(1);
        assertThat(job.runOnce()).isEqualTo(1);
        assertThat(job.runOnce()).isEqualTo(1);
        assertThat(sender.sent).hasSize(2);
        assertThat(job.runOnce()).isZero();
    }

    String notificationIdOf(T t, UUID appointment) {
        return seed.inTenant(t.id(), () -> jdbc.queryForObject(
            "SELECT id::text FROM notifications WHERE appointment_id = ? AND status = 'sent'", String.class, appointment));
    }

    String keyOf(String phone) {
        List<String> keys = sender.sent.stream().filter(s -> s.phone().equals(phone)).map(FakeSender.Sent::idempotencyKey).toList();
        assertThat(keys).hasSize(1);
        return keys.getFirst();
    }
}
