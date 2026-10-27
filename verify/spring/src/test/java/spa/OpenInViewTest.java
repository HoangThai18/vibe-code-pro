package spa;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;
import spa.support.ApiTest;
import spa.support.Seed.T;

class OpenInViewTest {
    abstract static class Base extends ApiTest {
        T t;
        UUID appointment;

        @BeforeEach
        void seedAppointment() {
            t = seed.tenant("Spa A");
            UUID c = seed.customer(t, "Khách", "0912345678");
            appointment = seed.appointment(t, c, t.staff(), Instant.parse("2026-11-02T03:00:00Z"), Instant.parse("2026-11-02T04:00:00Z"), "booked");
        }

        String lazyLoad() {
            var body = api.get(t.path("/probe/appointments/" + appointment + "/customer-name"), t.owner()).body();
            return body.has("error") ? body.path("error").asString() : body.path("name").asString();
        }
    }

    @Nested
    @TestPropertySource(properties = "spring.jpa.open-in-view=true")
    class On extends Base {
        @Test
        void lazyLoadRunsWithoutTheTenantAndFindsNothing() {
            // The EntityManager stays open, the query runs after commit in auto-commit: RLS hides the customer
            assertThat(lazyLoad()).isEqualTo("jakarta.persistence.EntityNotFoundException");
        }
    }

    @Nested
    class Off extends Base {
        @Test
        void lazyLoadFailsFastOutsideTheTransaction() {
            assertThat(lazyLoad()).isEqualTo("org.hibernate.LazyInitializationException");
        }
    }
}
