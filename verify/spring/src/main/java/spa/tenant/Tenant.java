package spa.tenant;

import java.util.UUID;
import spa.auth.Role;

/** The tenant a unit of work runs in. userId and role are null for jobs. */
public record Tenant(UUID id, UUID userId, Role role) {
    public static Tenant of(UUID id) {
        return new Tenant(id, null, null);
    }
}
