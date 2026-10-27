package spa;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.ScrollPosition;
import org.springframework.data.domain.Sort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.orm.jpa.vendor.HibernateJpaDialect;
import org.springframework.transaction.support.TransactionTemplate;
import spa.customers.CustomerRepository;
import spa.support.ApiTest;
import spa.support.Probes.AsyncCounter;
import spa.support.Seed.T;
import spa.tenant.Tenant;
import spa.tenant.TenantContext;

class TenantTransactionTest extends ApiTest {
    @Autowired
    DataSource dataSource;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    TransactionTemplate tx;
    @Autowired
    CustomerRepository customers;
    @Autowired
    AsyncCounter async;
    T a;

    @BeforeEach
    void seedTenant() {
        a = seed.tenant("Spa A");
        seed.customer(a, "Khách của A", "0912345678");
    }

    <R> R inA(java.util.function.Supplier<R> fn) {
        return TenantContext.call(Tenant.of(a.id()), fn);
    }

    @Test
    void noPooledConnectionKeepsTheTenantAfterARequest() throws Exception {
        for (int i = 0; i < 20; i++) assertThat(api.get(a.path("/customers"), a.owner()).status()).isEqualTo(200);
        var pool = (HikariDataSource) dataSource;
        List<Connection> all = new ArrayList<>();
        try {
            for (int i = 0; i < pool.getMaximumPoolSize(); i++) all.add(pool.getConnection());
            for (Connection c : all) {
                try (var rs = c.createStatement().executeQuery("SELECT current_setting('app.tenant_id', true)")) {
                    rs.next();
                    assertThat(rs.getString(1)).isNullOrEmpty();
                }
            }
        } finally {
            for (Connection c : all) c.close();
        }
    }

    @Test
    void sessionLevelSettingLeaksToTheNextBorrower() {
        try (var pool = appPool()) {
            var db = new JdbcTemplate(pool);
            // "Request" 1 for tenant A sets the tenant for the session (SET app.tenant_id = ... does the same)
            db.queryForObject("SELECT set_config('app.tenant_id', ?, false)", String.class, a.id().toString());
            // "Request" 2 sets nothing (a job, a route the filter skips, a failed filter) and gets the same connection
            assertThat(db.queryForObject("SELECT count(*) FROM customers", Long.class)).isEqualTo(1);   // A's rows
        }
        try (var pool = appPool()) {
            var db = new JdbcTemplate(pool);
            var localTx = new TransactionTemplate(new org.springframework.jdbc.support.JdbcTransactionManager(pool));
            localTx.execute(s -> db.queryForObject("SELECT set_config('app.tenant_id', ?, true)", String.class, a.id().toString()));
            assertThat(db.queryForObject("SELECT count(*) FROM customers", Long.class)).isZero();       // gone with the transaction
        }
    }

    @Test
    void readOutsideATransactionSeesNothing() {
        assertThat(inA(() -> jdbc.queryForObject("SELECT count(*) FROM customers", Long.class))).isZero();          // auto-commit
        Long inTx = inA(() -> tx.execute(s -> jdbc.queryForObject("SELECT count(*) FROM customers", Long.class)));
        assertThat(inTx).isEqualTo(1);
    }

    @Test
    void declaredRepositoryMethodsGetNoTransaction() {
        // CRUD methods: SimpleJpaRepository is @Transactional(readOnly = true), so the tenant is set
        assertThat(inA(() -> customers.findAll().size())).isEqualTo(1);
        // Declared query methods: no transaction unless you add one, so auto-commit and 0 rows
        assertThat(inA(() -> customers.findAllBy(ScrollPosition.keyset(), Sort.by("id"), Limit.of(10)).size())).isZero();
        Integer inTx = inA(() -> tx.execute(s -> customers.findAllBy(ScrollPosition.keyset(), Sort.by("id"), Limit.of(10)).size()));
        assertThat(inTx).isEqualTo(1);
    }

    @Test
    void switchingTenantInsideATransactionIsRefused() {
        assertThatThrownBy(() -> tx.execute(s -> inA(() -> customers.count()))).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void asyncCodeHasNoRequestTenant() {
        assertThat(inA(() -> async.countInCallersTenant().join())).isZero();
        assertThat(async.count(a.id()).join()).isEqualTo(1);
    }

    @Test
    void theDialectIsInstalled() {
        var tm = (org.springframework.orm.jpa.JpaTransactionManager) tx.getTransactionManager();
        assertThat(tm.getJpaDialect()).isInstanceOf(spa.tenant.TenantJpaDialect.class).isInstanceOf(HibernateJpaDialect.class);
    }

    HikariDataSource appPool() {
        var pool = new HikariDataSource();
        pool.setJdbcUrl(System.getenv("DB_URL"));
        pool.setUsername(System.getenv("DB_APP_USER"));
        pool.setPassword(System.getenv("DB_APP_PASSWORD"));
        pool.setMaximumPoolSize(1);
        return pool;
    }
}
