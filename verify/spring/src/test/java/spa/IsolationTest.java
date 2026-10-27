package spa;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import spa.support.Api.Res;
import spa.support.ApiTest;
import spa.support.Seed.T;

class IsolationTest extends ApiTest {
    record Route(String name, String method, String path, Map<String, ?> body) {
        @Override
        public String toString() {
            return name;
        }
    }

    // One row per route with a tenant resource id (isolation-tests.md section 2)
    static Stream<Route> crossTenantRoutes() {
        return Stream.of(
            new Route("GET customers/{id}", "GET", "/customers/%s", null),
            new Route("PATCH customers/{id}", "PATCH", "/customers/%s", Map.of("fullName", "hack")));
    }

    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    javax.sql.DataSource dataSource;
    T a;
    T b;
    UUID aCustomer;
    UUID bCustomer;

    @BeforeEach
    void seedTwoTenants() {
        a = seed.tenant("Spa A");
        b = seed.tenant("Spa B");
        aCustomer = seed.customer(a, "Khách của A", "0912345678");
        bCustomer = seed.customer(b, "Khách của B", "0987654321");
    }

    Res call(Route r, T pathTenant, UUID id, UUID user) {
        return api.send(r.method(), pathTenant.path(r.path().formatted(id)), user, r.body());
    }

    @ParameterizedTest(name = "{0}: tenant A cannot touch tenant B data")
    @MethodSource("crossTenantRoutes")
    void crossTenant(Route route) {
        assertThat(call(route, a, bCustomer, a.owner()).status()).isEqualTo(404);   // B's id in A's path: RLS
        assertThat(call(route, b, bCustomer, a.owner()).status()).isEqualTo(404);   // B's path: membership check
        assertThat(api.get(b.path("/customers/" + bCustomer), b.owner()).body().at("/data/fullName").asString())
            .isEqualTo("Khách của B");                                              // B's data unchanged
        assertThat(call(route, b, bCustomer, b.owner()).status()).isEqualTo(200);   // control: B itself succeeds
    }

    @Test
    void listHasOwnRowsOnly() {
        List<String> ids = api.get(a.path("/customers?limit=100"), a.owner()).body().path("data")
            .valueStream().map(c -> c.path("id").asString()).toList();
        assertThat(ids).contains(aCustomer.toString()).doesNotContain(bCustomer.toString());
        assertThat(api.get(b.path("/customers"), a.owner()).status()).isEqualTo(404);
    }

    @Test
    void tenantIdInBodyIsIgnored() {
        Res created = api.post(a.path("/customers"), a.owner(),
            Map.of("fullName", "Tạo lậu", "phone", "0911111111", "tenantId", b.id()));
        assertThat(created.status()).isEqualTo(201);
        String id = created.body().at("/data/id").asString();
        assertThat(api.get(a.path("/customers/" + id), a.owner()).status()).isEqualTo(200);
        assertThat(api.get(b.path("/customers/" + id), b.owner()).status()).isEqualTo(404);
    }

    @Test
    void cannotBookAnotherTenantsCustomer() {
        var slot = Map.of("staffUserId", a.manager(), "startsAt", "2026-11-02T03:00:00Z", "endsAt", "2026-11-02T04:00:00Z");
        Res cross = api.post(a.path("/appointments"), a.owner(), with(slot, "customerId", bCustomer));
        assertThat(cross.status()).isEqualTo(422);
        assertThat(cross.code()).isEqualTo("invalid_reference");
        assertThat(api.post(a.path("/appointments"), a.owner(), with(slot, "customerId", aCustomer)).status()).isEqualTo(201);
    }

    @Test
    void malformedOrUnknownTenantIs404() {
        assertThat(api.get("/v1/t/not-a-uuid/customers", a.owner()).status()).isEqualTo(404);
        assertThat(api.get("/v1/t/" + UUID.randomUUID() + "/customers", a.owner()).status()).isEqualTo(404);
        assertThat(api.get(a.path("/customers/not-a-uuid"), a.owner()).status()).isEqualTo(404);
    }

    @Test
    void appRoleWithoutTenantSeesNothing() {
        // The app's own pool, outside any transaction: no app.tenant_id, so 0 rows (fail closed)
        assertThat(jdbc.queryForObject("SELECT count(*) FROM customers", Long.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT current_user", String.class)).isEqualTo("spring_app");
        assertThat(jdbc.queryForMap("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"))
            .containsEntry("rolsuper", false).containsEntry("rolbypassrls", false);
    }

    @Test
    void membershipCheckIgnoresALeakedUserId() throws Exception {
        // Something set app.user_id for the session on every pooled connection (a login helper using SET)
        var pool = (com.zaxxer.hikari.HikariDataSource) dataSource;
        var all = new java.util.ArrayList<java.sql.Connection>();
        try {
            for (int i = 0; i < pool.getMaximumPoolSize(); i++) all.add(pool.getConnection());
            for (var c : all) c.createStatement().execute("SELECT set_config('app.user_id', '" + b.owner() + "', false)");
        } finally {
            for (var c : all) c.close();
        }
        try {
            // membership_read also matches user_id = app.user_id: only "tenant_id = app_current_tenant()" stops B's owner here
            assertThat(api.get(a.path("/customers"), b.owner()).status()).isEqualTo(404);
        } finally {
            pool.getHikariPoolMXBean().softEvictConnections();
        }
    }

    static Map<String, Object> with(Map<String, ?> base, String key, Object value) {
        var m = new java.util.HashMap<String, Object>(base);
        m.put(key, value);
        return m;
    }
}
