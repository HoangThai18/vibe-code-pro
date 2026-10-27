using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Spa.Api.Data;

namespace Spa.Api.Tenancy;

// /v1/t/{tenantId}/...: checks membership, then scopes the DbContext to that spa
public class TenantMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext ctx, AppDbContext db)
    {
        if (ctx.Request.RouteValues.TryGetValue("tenantId", out var raw) && Guid.TryParse(raw?.ToString(), out var tenantId))
        {
            var userId = Guid.Parse(ctx.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? Guid.Empty.ToString());
            var isMember = await db.Memberships.AnyAsync(m => m.TenantId == tenantId && m.UserId == userId);
            if (!isMember)
            {
                ctx.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }
            db.TenantId = tenantId;
        }
        await next(ctx);
    }
}
