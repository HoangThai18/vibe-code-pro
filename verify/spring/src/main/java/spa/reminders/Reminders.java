package spa.reminders;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** The SQL of jobs.md section 3. Call inside a transaction with the tenant set. */
@Repository
class Reminders {
    record Due(UUID id, String phone, String text) {}

    private final JdbcTemplate jdbc;

    Reminders(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    List<Due> createAndListPending() {
        // Wide window + UNIQUE (tenant_id, appointment_id, kind): a missed run catches up, never twice
        jdbc.update("""
            INSERT INTO notifications (tenant_id, appointment_id, kind)
            SELECT tenant_id, id, 'reminder_24h' FROM appointments
             WHERE status IN ('booked', 'confirmed')
               AND starts_at > now() + interval '2 hours' AND starts_at <= now() + interval '24 hours'
            ON CONFLICT (tenant_id, appointment_id, kind) DO NOTHING""");
        return jdbc.query("""
            SELECT n.id, c.phone, c.full_name, a.starts_at, t.time_zone FROM notifications n
              JOIN appointments a ON a.tenant_id = n.tenant_id AND a.id = n.appointment_id
              JOIN customers c ON c.tenant_id = a.tenant_id AND c.id = a.customer_id
              JOIN tenants t ON t.id = n.tenant_id
             WHERE n.kind = 'reminder_24h' AND n.status = 'pending' AND a.status IN ('booked', 'confirmed')
             ORDER BY a.starts_at LIMIT 500""",
            (rs, i) -> new Due(rs.getObject(1, UUID.class), rs.getString(2), ReminderText.of(rs.getString(3),
                rs.getObject(4, OffsetDateTime.class).toInstant(), rs.getString(5))));
    }

    void markSent(UUID id) {
        jdbc.update("UPDATE notifications SET status = 'sent', sent_at = now() WHERE id = ? AND status = 'pending'", id);
    }
}
