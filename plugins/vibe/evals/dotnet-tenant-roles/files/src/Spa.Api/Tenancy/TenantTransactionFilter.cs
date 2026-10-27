using Microsoft.EntityFrameworkCore;
using Spa.Api.Data;

namespace Spa.Api.Tenancy;

// One transaction per tenant request; its first statement sets the RLS tenant (transaction-local)
public class TenantTransactionFilter(SpaDb db) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var tenantId = (string)ctx.HttpContext.GetRouteValue("tenantId")!;
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlAsync($"SELECT set_config('app.tenant_id', {tenantId}, true)");
        var result = await next(ctx);
        await tx.CommitAsync();
        return result;
    }
}
