// Spa.Api/Tenancy/TenantFilter.cs
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Spa.Api.Data;
using Spa.Api.Http;

namespace Spa.Api.Tenancy;

// The current request's membership, set by TenantFilter before the handler body runs
public sealed class RequestTenant
{
    public Member Member { get; set; } = null!;
}

public static class TenantDb
{
    // One transaction per request or job; its first statement sets the RLS tenant for that transaction only
    public static async Task<IDbContextTransaction> BeginTenantAsync(this SpaDb db, Guid tenantId, CancellationToken ct)
    {
        var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlAsync($"SELECT set_config('app.tenant_id', {tenantId.ToString()}, true)", ct);
        return tx;
    }
}

// On every /v1/t/{tenantId} endpoint: transaction + tenant, membership (404), permission (403), commit
public sealed class TenantFilter(SpaDb db, RequestTenant current, IAuthorizationService authz) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var http = ctx.HttpContext;
        var ct = http.RequestAborted;
        try
        {
            var tenantId = Guid.Parse((string)http.GetRouteValue("tenantId")!);   // {tenantId:guid}: malformed ids are 404 already
            var userId = Guid.Parse(http.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var required = http.GetEndpoint()?.Metadata.GetMetadata<PermissionRequirement>()
                ?? throw ApiException.Forbidden("none");                           // an endpoint without a permission: deny
            await using var tx = await db.BeginTenantAsync(tenantId, ct);
            // Filter on the path tenant: membership_read also matches app.user_id (postgres-rls.md section 4)
            var role = await db.Memberships.Where(m => m.TenantId == tenantId && m.UserId == userId)
                .Select(m => m.Role).SingleOrDefaultAsync(ct)
                ?? throw ApiException.NotFound();                                  // not a member: 404, as if no such tenant
            current.Member = new Member(tenantId, userId, role);
            if (!(await authz.AuthorizeAsync(http.User, current.Member, required)).Succeeded)
                throw ApiException.Forbidden(required.Action);
            var result = await next(ctx);   // the IResult, not written yet: commit first
            await tx.CommitAsync(ct);
            return result;
        }
        catch (ApiException e)
        {
            return e.ToResult();            // the transaction was disposed without commit: rolled back
        }
    }
}
