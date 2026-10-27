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
