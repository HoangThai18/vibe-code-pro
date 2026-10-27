package vn.spa.crm.tenant;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Sets the spa of the logged-in user for Postgres RLS (policies read app.tenant_id). */
@Component
public class TenantFilter extends OncePerRequestFilter {
    private final JdbcTemplate jdbc;

    public TenantFilter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (SecurityContextHolder.getContext().getAuthentication() instanceof JwtAuthenticationToken jwt) {
            UUID tenantId = UUID.fromString(jwt.getToken().getClaimAsString("tenant_id"));
            jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, false)", String.class, tenantId.toString());
        }
        chain.doFilter(request, response);
    }
}
