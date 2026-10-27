package spa;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import spa.support.Api.Res;
import spa.support.ApiTest;
import spa.support.Seed.T;
import tools.jackson.databind.JsonNode;

class CustomerApiTest extends ApiTest {
    @Autowired
    JdbcTemplate jdbc;
    T a;
    T b;

    @BeforeEach
    void seedTenants() {
        a = seed.tenant("Spa A");
        b = seed.tenant("Spa B");
    }

    @Test
    void createNormalizesPhone() {
        Res res = api.post(a.path("/customers"), a.owner(), Map.of("fullName", "Nguyễn Thị Thảo", "phone", "+84 912 345 678"));
        assertThat(res.status()).isEqualTo(201);
        assertThat(res.body().at("/data/phone").asString()).isEqualTo("0912345678");
        assertThat(api.post(a.path("/customers"), a.owner(), Map.of("fullName", "X", "phone", "12345")).status()).isEqualTo(400);
    }

    @Test
    void duplicatePhoneInTenantIs409OnCreateAndUpdate() {
        api.post(a.path("/customers"), a.owner(), Map.of("fullName", "Thảo", "phone", "0912345678"));
        Res dup = api.post(a.path("/customers"), a.owner(), Map.of("fullName", "Khác", "phone", "0912 345 678"));
        assertThat(dup.status()).isEqualTo(409);
        assertThat(dup.code()).isEqualTo("customer_phone_taken");

        String other = api.post(a.path("/customers"), a.owner(), Map.of("fullName", "Lan", "phone", "0987654321"))
            .body().at("/data/id").asString();
        Res patch = api.patch(a.path("/customers/" + other), a.owner(), Map.of("phone", "0912345678"));
        assertThat(patch.status()).isEqualTo(409);
        assertThat(patch.code()).isEqualTo("customer_phone_taken");

        // Another tenant may use the same number: the unique key is (tenant_id, phone)
        assertThat(api.post(b.path("/customers"), b.owner(), Map.of("fullName", "Thảo", "phone", "0912345678")).status()).isEqualTo(201);
    }

    @Test
    void keysetPagesHaveNoGapsOrDuplicates() {
        Instant same = Instant.parse("2026-10-01T03:00:00Z");
        List<String> expected = new ArrayList<>();
        for (int i = 0; i < 25; i++) {
            UUID id = seed.customer(a, "Khách " + i, "09000000%02d".formatted(i));
            if (i < 10) {   // ten rows with the same created_at: the id breaks the tie
                seed.inTenant(a.id(), () -> jdbc.update("UPDATE customers SET created_at = ? WHERE id = ?", java.sql.Timestamp.from(same), id));
            }
            expected.add(id.toString());
        }
        List<String> seen = new ArrayList<>();
        List<Integer> sizes = new ArrayList<>();
        String cursor = "";
        do {
            JsonNode page = api.get(a.path("/customers?limit=10&cursor=" + cursor), a.owner()).body();
            page.path("data").forEach(c -> seen.add(c.path("id").asString()));
            sizes.add(page.path("data").size());
            cursor = page.path("nextCursor").isNull() ? null : page.path("nextCursor").asString();
        } while (cursor != null);
        assertThat(sizes).containsExactly(10, 10, 5);
        assertThat(seen).doesNotHaveDuplicates().containsExactlyInAnyOrderElementsOf(expected);
        assertThat(api.get(a.path("/customers?cursor=bm9wZQ"), a.owner()).code()).isEqualTo("invalid_cursor");
    }
}
