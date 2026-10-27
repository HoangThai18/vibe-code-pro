# Spring Boot: tenant API on PostgreSQL RLS

The example app's customer and appointment API in Spring Boot, isolated by RLS. Ran with Spring Boot 4.1.2 (Spring Framework 7.0.10, Spring Security 7.1.2, Spring Data JPA 4.1.2, Hibernate 7.4.13, HikariCP 7.0.2, Flyway 12.4.0, PgJDBC 42.7.14), Java 21, PostgreSQL 16 with FORCE RLS, from an empty database, the app connected as a role without BYPASSRLS: 57 tests (section 7). The reasons are in `references/postgres-rls.md`, `references/auth.md` section 4, `references/api-conventions.md`, `references/data-layer.md` section 6, `references/jobs.md` and `references/isolation-tests.md`.

## Contents
1. Roles and migrations
2. Setting the tenant
3. Membership (404) and permissions (403)
4. JPA: mapping, N+1, pagination
5. No double booking
6. Reminder job
7. Traps and tests

## 1. Roles and migrations

Controller → service (`@PreAuthorize` + `@Transactional`) → Spring Data repository; the tenant comes from the path `/v1/t/{tenantId}/...`. The app and Flyway use different roles (`references/postgres-rls.md` section 1); `spring.flyway.user` without `spring.flyway.url` reuses the datasource URL:

```yaml
spring:
  datasource:
    url: ${DB_URL}
    username: ${DB_APP_USER}          # NOSUPERUSER NOBYPASSRLS, not the table owner
    password: ${DB_APP_PASSWORD}
  flyway:
    user: ${DB_OWNER_USER}            # owns the tables: DDL only; the app never connects as it
    password: ${DB_OWNER_PASSWORD}
    placeholders:
      app_role: ${DB_APP_USER}
      definer_role: ${DB_DEFINER_ROLE}
  jpa:
    open-in-view: false               # no lazy loading after the transaction (it would run without the tenant)
app:
  jwt-secret: ${JWT_SECRET}
  reminders:
    cron: "0 */10 * * * *"
```

Flyway runs the SQL of `references/multi-tenant.md` and the references above at startup, as the table owner. So:

- `btree_gist` is a trusted extension: the owner creates it with `CREATE` on the database.
- `app_tenant_ids()` must belong to the BYPASSRLS definer, and `ALTER FUNCTION ... OWNER TO` needs `GRANT app_definer TO app_owner` and `GRANT USAGE, CREATE ON SCHEMA public TO app_definer`. A superuser runs those with the roles, once per environment; the migration takes role names from Flyway placeholders (`${app_role}`, `${definer_role}`).

## 2. Setting the tenant

Every transaction starts with `set_config('app.tenant_id', ?, true)`, from `TenantContext`, a `ThreadLocal<Tenant>`. The membership interceptor sets it per request and clears it in `afterCompletion`; jobs use `TenantContext.call(tenant, fn)`, which restores the previous value and throws if a transaction is already open (a transaction keeps the tenant it began with).

| Hook for `set_config` | Verdict |
|---|---|
| `HibernateJpaDialect.beginTransaction` (used) | Inside Spring's begin step, for every JPA transaction (`@Transactional`, `TransactionTemplate`, Spring Data's own); a failure is a failed begin: rollback, EntityManager closed |
| `TransactionExecutionListener.afterBegin` | Javadoc: for observation. It runs outside the begin cleanup: an exception there left the EntityManager bound to the thread |
| Filter or interceptor running `SET` | Leaks through the pool (section 7) |

Without JPA, override `JdbcTransactionManager.prepareTransactionalConnection` (same place; read in the source, not run).

```java
package spa.tenant;

import jakarta.persistence.EntityManager;
import java.sql.SQLException;
import org.springframework.orm.jpa.vendor.HibernateJpaDialect;
import org.springframework.transaction.TransactionDefinition;

/** set_config as the first statement of every JPA transaction, inside Spring's begin step. */
public class TenantJpaDialect extends HibernateJpaDialect {
    @Override
    public Object beginTransaction(EntityManager em, TransactionDefinition definition) throws SQLException {
        Object transactionData = super.beginTransaction(em, definition);
        Tenant tenant = TenantContext.current();
        if (tenant != null) {
            // true = local to this transaction: the pooled connection never carries it to the next request
            em.createNativeQuery("SELECT set_config('app.tenant_id', ?1, true)")
                .setParameter(1, tenant.id().toString())
                .getSingleResult();
        }
        return transactionData;
    }
}
```

Install it with a static `@Bean BeanPostProcessor` whose `postProcessBeforeInitialization` calls `setJpaDialect(new TenantJpaDialect())` on the `LocalContainerEntityManagerFactoryBean`; `JpaTransactionManager` then takes it from the factory. A `TransactionManagerCustomizer` calling `setJpaDialect` does not work: `afterPropertiesSet` overwrites it with the factory's dialect (every test that seeds data failed).

## 3. Membership (404) and permissions (403)

```java
package spa.tenant;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import spa.auth.Role;
import spa.web.ApiException;

/** /v1/t/{tenantId}/**: the user must be a member of the tenant in the path, else 404. */
@Component
class MembershipInterceptor implements HandlerInterceptor, WebMvcConfigurer {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    MembershipInterceptor(JdbcTemplate jdbc, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(this).addPathPatterns("/v1/t/{tenantId}/**");
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
        @SuppressWarnings("unchecked")
        var vars = (Map<String, String>) req.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
        UUID tenantId = parseUuid(vars.get("tenantId"));    // malformed: 404, not a 500 from ::uuid
        UUID userId = UUID.fromString(SecurityContextHolder.getContext().getAuthentication().getName());   // JWT sub
        // Its own short transaction with the tenant set. Filter on the current tenant: membership_read
        // also matches app.user_id (postgres-rls.md section 4)
        Role role = TenantContext.call(Tenant.of(tenantId), () -> tx.execute(s -> jdbc.queryForList(
                "SELECT role FROM memberships WHERE tenant_id = app_current_tenant() AND user_id = ?", String.class, userId)
            .stream().findFirst().map(Role::fromDb).orElse(null)));
        if (role == null) throw ApiException.notFound();    // not a member: don't reveal that the tenant exists
        TenantContext.set(new Tenant(tenantId, userId, role));
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest req, HttpServletResponse res, Object handler, Exception ex) {
        TenantContext.clear();   // Tomcat reuses the thread for the next request
    }

    private static UUID parseUuid(String raw) {
        try {
            UUID id = UUID.fromString(raw);
            if (id.toString().equalsIgnoreCase(raw)) return id;   // fromString also accepts "1-1-1-1-1"
        } catch (IllegalArgumentException ignored) {
            // 404 below
        }
        throw ApiException.notFound();
    }
}
```

- Method security (order 200) wraps `@Transactional` (lowest precedence), so `@PreAuthorize` runs before the transaction (a denial opened none) and must not query. `@PreAuthorize("@authz.can('customer.write')")` reads the stored role through `Permissions.can(role, action)`, the table of `references/auth.md` section 4; an unknown action throws, so a typo fails loudly.
- A denial throws `AuthorizationDeniedException`; a `@RestControllerAdvice` maps it to 403 `forbidden`, a malformed `{id}` to 404, `ApiException` to its status and code.
- Authentication here: a JWT resource server, `sub` = `users.id`.

## 4. JPA: mapping, N+1, pagination

- **Keys**: tables keep `PRIMARY KEY (tenant_id, id)` and composite FKs; entities map `@Id UUID id` alone, and services set `tenantId` from `TenantContext`.
- **A column that is a field and an association**: `customerId` plus `@ManyToOne(fetch = LAZY) @JoinColumn(name = "customer_id", insertable = false, updatable = false)` fails at startup (`DuplicateMappingException`) unless the field has `@Column(name = "customer_id")`. `@ManyToOne` defaults to EAGER.
- **N+1**: 10 appointments with customer names took 12 statements (`set_config`, the list, 10 customer selects); `JOIN FETCH`, 2. Count with `hibernate.generate_statistics=true` and `Statistics.getPrepareStatementCount()`.
- **Pagination**: `Window<Customer> findAllBy(ScrollPosition position, Sort sort, Limit limit)` scrolls by keyset (`createdAt DESC, id DESC`); the cursor is the last row's `createdAt|id` in base64url.

```java
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
```

## 5. No double booking

The exclusion constraint of `references/data-layer.md` section 6 never let an overlap through, but concurrent inserts can deadlock inside its check, each waiting for the other's uncommitted row: over HTTP, 2 of 180 rounds of 10 concurrent bookings gave nine 500s (`40P01`, `CannotAcquireLockException`); with a barrier right before the insert, 4 of 50 rounds booked nothing (`40P01`, then `57014` from `statement_timeout`). `lockStaff` queues the bookings of one staff member: 100 rounds, each one booking and nine `appointment_slot_taken`.

```java
package spa.appointments;

import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import spa.appointments.AppointmentDtos.AppointmentDto;
import spa.appointments.AppointmentDtos.NewAppointment;
import spa.tenant.TenantContext;
import spa.web.ApiException;
import spa.web.SqlState;

@Service
public class AppointmentService {
    private final AppointmentRepository appointments;

    AppointmentService(AppointmentRepository appointments) {
        this.appointments = appointments;
    }

    @PreAuthorize("@authz.canBookFor(#in.staffUserId())")
    @Transactional
    public AppointmentDto book(NewAppointment in) {
        UUID tenantId = TenantContext.current().id();
        // Without it, concurrent inserts can deadlock inside the exclusion check (40P01) instead of failing with 23P01
        appointments.lockStaff(tenantId, in.staffUserId());
        var a = new Appointment(tenantId, in.customerId(), in.staffUserId(), in.startsAt(), in.endsAt());
        try {
            return AppointmentDto.of(appointments.saveAndFlush(a));   // flush: the violation surfaces here, not at commit
        } catch (DataIntegrityViolationException e) {
            switch (String.valueOf(SqlState.of(e))) {
                // exclusion_violation: an overlapping appointment of that staff member, also under concurrency
                case "23P01" -> throw new ApiException(HttpStatus.CONFLICT, "appointment_slot_taken", "Khung giờ này đã có lịch.");
                // foreign_key_violation: customer or staff not in this tenant (composite FKs)
                case "23503" -> throw new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "invalid_reference",
                    "Khách hàng hoặc nhân viên không hợp lệ.");
                default -> throw e;
            }
        }
    }
}
```

- Spring throws `DataIntegrityViolationException` itself, caused by Hibernate's `ConstraintViolationException`, caused by `PSQLException`. `getConstraintName()` is null for `23P01`: read the SQLSTATE from the `SQLException` in the chain, or `PSQLException.getServerErrorMessage().getConstraint()`.
- `saveAndFlush`, not `save`: with `save` the INSERT runs at commit, outside the `try`: a 500.
- A duplicate phone works the same way: `23505` → 409 `customer_phone_taken`, on create and update.

## 6. Reminder job

```java
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
```

- **Several instances**: the advisory lock needs session pooling; behind PgBouncer in transaction mode, use ShedLock or a queue table claimed with `FOR UPDATE SKIP LOCKED`.
- **Idempotent per appointment**: `Reminders` runs the SQL of `references/jobs.md` section 3 (UNIQUE + `ON CONFLICT DO NOTHING`, `status = 'pending'` on read and update); the notification id is the provider's idempotency key.

## 7. Traps and tests

| Trap | What happened | Do instead |
|---|---|---|
| `set_config(..., false)` or `SET` in a filter, interceptor or Hikari `connection-init-sql` | The value stays on the connection: in a pool of 1, the next borrower that set nothing read tenant A's rows. A filter's `JdbcTemplate` call returns its connection at once; the request's queries may get another. Hikari resets autoCommit, readOnly, isolation, catalog, schema and network timeout, never custom settings (its source) | The dialect: after 20 requests no pooled connection held a tenant |
| Read outside a transaction | `JdbcTemplate` in auto-commit: 0 rows with `TenantContext` set | Call it from a `@Transactional` method |
| Spring Data outside a transaction | `findAll()`, `findById()` run in `SimpleJpaRepository`'s `@Transactional(readOnly = true)` and saw the tenant; declared query methods (`findAllBy(...)`, `@Query`) get no transaction: 0 rows | Repositories only inside services |
| `spring.jpa.open-in-view` (default true) | A lazy load after the service returned ran after commit, without the tenant: `EntityNotFoundException` for an existing row (with `set_config(..., false)` it worked, hiding that bug). Off: `LazyInitializationException` | `false`; fetch what you return |
| `@Async`, `@Scheduled` | Another thread, no `TenantContext`: 0 rows | Pass `tenantId`; `TenantContext.call` |
| `app.user_id` left on pooled connections | Without `tenant_id = app_current_tenant()` in the membership query, B's owner passed on A's path | Keep the predicate |

The tests start the app on a random port against a real PostgreSQL, call it over HTTP with signed tokens, and seed through the app's own connection with the tenant set. With Testcontainers, still connect the app as the app role: as the container's superuser it bypasses RLS and every isolation test passes.

| Tests | Cases |
|---|---|
| Isolation (8) | B's customer id in A's path and B's path → 404 (GET, PATCH), B unchanged, B's own call succeeds; lists; `tenantId` in a body ignored; B's customer in a booking → 422 `invalid_reference`; malformed or unknown tenant → 404; leaked `app.user_id` |
| Permissions (23) | 11 matrix rows; unknown action; staff writing customers or booking for another staff member → 403, non-member → 404 |
| Booking (5), customers (3) | the races; adjacent, other-staff and cancelled slots free; `+84 912 345 678` stored as `0912345678`; duplicate phone → 409 on create and update, free in another tenant; 25 rows (10 sharing `createdAt`) in pages of 10, 10, 5 |
| N+1 (3), traps (10), job (5) | the rows above; the listener hook; 2 reminders from appointments 1, 10, 30 hours ahead, cancelled, in a suspended tenant; a rerun sends 0; a second instance gets -1; a failed send is retried |

Removing any of these failed a test: `true` in `set_config`, the membership check or its tenant predicate, the exclusion constraint, `saveAndFlush`, staff-only-themselves, `app_tenant_ids()`, the job lock, `JOIN FETCH`, the guard in `TenantContext.call`, `open-in-view: false`, `status = 'pending'`, `ON CONFLICT`, the dialect. Without `lockStaff` the 100-round test failed 2 runs in 3: deadlocks depend on timing.
