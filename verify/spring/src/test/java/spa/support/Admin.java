package spa.support;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** The superuser from DATABASE_URL: only to wipe data between tests (it bypasses RLS). */
public final class Admin {
    public static final JdbcTemplate JDBC = new JdbcTemplate(new DriverManagerDataSource(
        System.getenv("DB_URL"), System.getenv("DB_ADMIN_USER"), System.getenv("DB_ADMIN_PASSWORD")));

    private Admin() {}

    public static void reset() {
        JDBC.execute("TRUNCATE tenants, users, memberships, customers, appointments, notifications CASCADE");
    }
}
