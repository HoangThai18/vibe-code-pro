package spa.reminders;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import spa.tenant.Tenant;
import spa.tenant.TenantContext;

@Component
public class ReminderJob {
    private static final Logger log = LoggerFactory.getLogger(ReminderJob.class);
    private final DataSource dataSource;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final Reminders reminders;
    private final ReminderSender sender;

    ReminderJob(DataSource dataSource, JdbcTemplate jdbc, TransactionTemplate tx, Reminders reminders, ReminderSender sender) {
        this.dataSource = dataSource;
        this.jdbc = jdbc;
        this.tx = tx;
        this.reminders = reminders;
        this.sender = sender;
    }

    /** Reminders sent, or -1 when another instance holds the lock. Not @Transactional: one per tenant below. */
    @Scheduled(cron = "${app.reminders.cron}", zone = "Asia/Ho_Chi_Minh")
    public int runOnce() {
        // Session-level advisory lock on a connection held for the run: one instance at a time.
        // Unlock on that connection: a lock left on a pooled connection stays held.
        try (Connection lock = dataSource.getConnection()) {
            if (!advisory(lock, "pg_try_advisory_lock")) return -1;
            try {
                int sent = 0;
                // app_tenant_ids(): the job has no tenant, so RLS would show it 0 tenants
                for (UUID tenantId : jdbc.queryForList("SELECT id FROM app_tenant_ids() AS id", UUID.class)) {
                    sent += TenantContext.call(Tenant.of(tenantId), this::remindTenant);
                }
                return sent;
            } finally {
                advisory(lock, "pg_advisory_unlock");
            }
        } catch (SQLException e) {
            throw new IllegalStateException("reminder job lock", e);
        }
    }

    private int remindTenant() {
        List<Reminders.Due> due = tx.execute(s -> reminders.createAndListPending());
        int sent = 0;
        for (Reminders.Due d : due) {
            try {
                sender.send(d.phone(), d.text(), d.id().toString());   // outside any transaction; key = notification id
            } catch (RuntimeException e) {
                log.warn("reminder {} failed, stays pending for the next run", d.id(), e);
                continue;
            }
            tx.executeWithoutResult(s -> reminders.markSent(d.id()));
            sent++;
        }
        return sent;
    }

    private static boolean advisory(Connection c, String function) throws SQLException {
        try (var st = c.prepareStatement("SELECT " + function + "(hashtextextended('reminder-job', 0))");
             var rs = st.executeQuery()) {
            rs.next();
            return rs.getBoolean(1);
        }
    }
}
