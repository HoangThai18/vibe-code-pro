package spa;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import spa.auth.Permissions;
import spa.auth.Role;
import spa.support.Api.Res;
import spa.support.ApiTest;
import spa.support.Seed.T;

class PermissionMatrixTest extends ApiTest {
    @ParameterizedTest(name = "{0} {1} → {2}")
    @CsvSource({
        "OWNER,   billing.manage,      true",
        "OWNER,   api_key.manage,      true",
        "MANAGER, appointment.confirm, true",
        "MANAGER, customer.import,     true",
        "MANAGER, billing.manage,      false",
        "MANAGER, api_key.manage,      false",
        "STAFF,   customer.read,       true",
        "STAFF,   customer.write,      false",
        "STAFF,   appointment.write,   true",
        "STAFF,   appointment.confirm, false",
        "STAFF,   member.role_change,  false",
    })
    void matrix(Role role, String action, boolean expected) {
        assertThat(Permissions.can(role, action)).isEqualTo(expected);
    }

    @Test
    void unknownActionFailsLoudly() {
        assertThatThrownBy(() -> Permissions.can(Role.OWNER, "customer.wirte")).isInstanceOf(IllegalArgumentException.class);
    }

    @org.springframework.beans.factory.annotation.Autowired
    spa.customers.CustomerService customers;
    @org.springframework.beans.factory.annotation.Autowired
    jakarta.persistence.EntityManagerFactory emf;
    T t;
    UUID customer;
    int hour;

    @Test
    void deniedBeforeAnyTransactionBegins() {
        var stats = emf.unwrap(org.hibernate.SessionFactory.class).getStatistics();
        stats.clear();
        // Method security (order 200) wraps @Transactional (lowest precedence): @PreAuthorize runs first
        assertThatThrownBy(() -> spa.tenant.TenantContext.call(new spa.tenant.Tenant(t.id(), t.staff(), Role.STAFF),
                () -> customers.create(new spa.customers.CustomerDtos.NewCustomer("Mới", "0900000001", null, null))))
            .isInstanceOf(org.springframework.security.authorization.AuthorizationDeniedException.class);
        assertThat(stats.getTransactionCount()).isZero();
    }

    @BeforeEach
    void seedTenant() {
        t = seed.tenant("Spa A");
        customer = seed.customer(t, "Khách", "0912345678");
        hour = 0;
    }

    // The same routes through HTTP, as each role: method security answers 403, the membership check 404
    @ParameterizedTest(name = "{0}: {1} → {2}")
    @CsvSource({
        "owner,   create customer,           201",
        "manager, create customer,           201",
        "staff,   create customer,           403",
        "staff,   update customer,           403",
        "manager, update customer,           200",
        "staff,   list customers,            200",
        "staff,   book for themselves,       201",
        "staff,   book for another staff,    403",
        "manager, book for a staff member,   201",
        "outsider, list customers,           404",
    })
    void http(String who, String what, int expected) {
        UUID user = switch (who) {
            case "owner" -> t.owner();
            case "manager" -> t.manager();
            case "staff" -> t.staff();
            default -> seed.user();   // not a member of t
        };
        Function<UUID, Map<String, Object>> slot = staff -> Map.of("customerId", customer, "staffUserId", staff,
            "startsAt", "2026-11-02T0" + hour + ":00:00Z", "endsAt", "2026-11-02T0" + (hour + 1) + ":00:00Z");
        Res res = switch (what) {
            case "create customer" -> api.post(t.path("/customers"), user, Map.of("fullName", "Mới", "phone", "0900000001"));
            case "update customer" -> api.patch(t.path("/customers/" + customer), user, Map.of("fullName", "Sửa"));
            case "list customers" -> api.get(t.path("/customers"), user);
            case "book for themselves" -> api.post(t.path("/appointments"), user, slot.apply(user));
            case "book for another staff" -> api.post(t.path("/appointments"), user, slot.apply(t.staff2()));
            case "book for a staff member" -> api.post(t.path("/appointments"), user, slot.apply(t.staff()));
            default -> throw new IllegalArgumentException(what);
        };
        assertThat(res.status()).isEqualTo(expected);
        if (expected == 403) assertThat(res.code()).isEqualTo("forbidden");
    }
}
