package spa.support;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import spa.tenant.Tenant;
import spa.tenant.TenantContext;

/** Seeds through the app's own connection (spring_app) with the tenant set, as createTenant does. */
@Component
public class Seed {
    public record T(UUID id, UUID owner, UUID manager, UUID staff, UUID staff2) {
        public String path(String rest) {
            return "/v1/t/" + id + rest;
        }
    }

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    Seed(JdbcTemplate jdbc, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    public T tenant(String name) {
        return tenant(name, "active");
    }

    public T tenant(String name, String status) {
        UUID id = UUID.randomUUID();
        var t = new T(id, user(), user(), user(), user());
        inTenant(id, () -> {
            jdbc.update("INSERT INTO tenants (id, name, status) VALUES (?, ?, ?)", id, name, status);
            for (var m : Map.of(t.owner(), "owner", t.manager(), "manager", t.staff(), "staff", t.staff2(), "staff").entrySet()) {
                jdbc.update("INSERT INTO memberships (tenant_id, user_id, role) VALUES (?, ?, ?)", id, m.getKey(), m.getValue());
            }
            return null;
        });
        return t;
    }

    public UUID user() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, email) VALUES (?, ?)", id, id + "@example.vn");   // users: global, no RLS
        return id;
    }

    public UUID customer(T t, String name, String phone) {
        return inTenant(t.id(), () -> jdbc.queryForObject(
            "INSERT INTO customers (tenant_id, full_name, phone) VALUES (?, ?, ?) RETURNING id", UUID.class, t.id(), name, phone));
    }

    public UUID appointment(T t, UUID customer, UUID staff, Instant startsAt, Instant endsAt, String status) {
        return inTenant(t.id(), () -> jdbc.queryForObject("""
            INSERT INTO appointments (tenant_id, customer_id, staff_user_id, starts_at, ends_at, status)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING id""", UUID.class, t.id(), customer, staff,
            java.sql.Timestamp.from(startsAt), java.sql.Timestamp.from(endsAt), status));
    }

    public <R> R inTenant(UUID tenantId, java.util.function.Supplier<R> fn) {
        return TenantContext.call(Tenant.of(tenantId), () -> tx.execute(s -> fn.get()));
    }
}
