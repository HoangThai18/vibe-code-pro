package spa.auth;

import java.util.Map;
import java.util.Set;

/** One place for role → permissions, deny by default (auth.md section 4). */
public final class Permissions {
    public static final Set<String> ACTIONS = Set.of(
        "customer.read", "customer.write", "customer.import",
        "appointment.write", "appointment.confirm",
        "billing.manage", "member.invite", "member.role_change", "api_key.manage");

    private static final Map<Role, Set<String>> GRANTS = Map.of(
        Role.OWNER, ACTIONS,
        Role.MANAGER, Set.of("customer.read", "customer.write", "customer.import", "appointment.write",
            "appointment.confirm", "member.invite", "member.role_change"),
        Role.STAFF, Set.of("customer.read", "appointment.write"));   // own appointments only: Authz.canBookFor

    private Permissions() {}

    public static boolean can(Role role, String action) {
        if (!ACTIONS.contains(action)) {
            throw new IllegalArgumentException("unknown action: " + action);   // a typo in @PreAuthorize fails loudly
        }
        return role != null && GRANTS.getOrDefault(role, Set.of()).contains(action);
    }
}
