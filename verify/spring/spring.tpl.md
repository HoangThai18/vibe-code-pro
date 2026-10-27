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
{{src/main/resources/application.yml}}
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
{{src/main/java/spa/tenant/TenantJpaDialect.java}}
```

Install it with a static `@Bean BeanPostProcessor` whose `postProcessBeforeInitialization` calls `setJpaDialect(new TenantJpaDialect())` on the `LocalContainerEntityManagerFactoryBean`; `JpaTransactionManager` then takes it from the factory. A `TransactionManagerCustomizer` calling `setJpaDialect` does not work: `afterPropertiesSet` overwrites it with the factory's dialect (every test that seeds data failed).

## 3. Membership (404) and permissions (403)

```java
{{src/main/java/spa/tenant/MembershipInterceptor.java}}
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
{{src/main/java/spa/appointments/AppointmentRepository.java}}
```

## 5. No double booking

The exclusion constraint of `references/data-layer.md` section 6 never let an overlap through, but concurrent inserts can deadlock inside its check, each waiting for the other's uncommitted row: over HTTP, 2 of 180 rounds of 10 concurrent bookings gave nine 500s (`40P01`, `CannotAcquireLockException`); with a barrier right before the insert, 4 of 50 rounds booked nothing (`40P01`, then `57014` from `statement_timeout`). `lockStaff` queues the bookings of one staff member: 100 rounds, each one booking and nine `appointment_slot_taken`.

```java
{{src/main/java/spa/appointments/AppointmentService.java}}
```

- Spring throws `DataIntegrityViolationException` itself, caused by Hibernate's `ConstraintViolationException`, caused by `PSQLException`. `getConstraintName()` is null for `23P01`: read the SQLSTATE from the `SQLException` in the chain, or `PSQLException.getServerErrorMessage().getConstraint()`.
- `saveAndFlush`, not `save`: with `save` the INSERT runs at commit, outside the `try`: a 500.
- A duplicate phone works the same way: `23505` → 409 `customer_phone_taken`, on create and update.

## 6. Reminder job

```java
{{src/main/java/spa/reminders/ReminderJob.java}}
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
