package spa.auth;

import java.util.UUID;
import org.springframework.stereotype.Component;
import spa.tenant.Tenant;
import spa.tenant.TenantContext;

/** Used in @PreAuthorize: the role comes from the membership the interceptor checked. */
@Component("authz")
public class Authz {
    public boolean can(String action) {
        Tenant t = TenantContext.current();
        return t != null && Permissions.can(t.role(), action);
    }

    // Per-record rule (auth.md section 5): staff book only for themselves
    public boolean canBookFor(UUID staffUserId) {
        Tenant t = TenantContext.current();
        return can("appointment.write") && (t.role() != Role.STAFF || t.userId().equals(staffUserId));
    }
}
