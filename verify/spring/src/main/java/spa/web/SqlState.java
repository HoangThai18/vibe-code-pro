package spa.web;

import java.sql.SQLException;

public final class SqlState {
    private SqlState() {}

    /** The SQLSTATE under Spring's DataIntegrityViolationException → Hibernate's exception → PSQLException. */
    public static String of(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof SQLException sql && sql.getSQLState() != null) return sql.getSQLState();
        }
        return null;
    }
}
