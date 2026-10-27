using Microsoft.EntityFrameworkCore;
using Spa.Api.Data;
using Spa.Api.Tenancy;

namespace Spa.Api.Jobs;

public sealed partial class ReminderJob
{
    async Task MarkAsync(Guid tenantId, Guid id, string status, CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SpaDb>();
        await using var tx = await db.BeginTenantAsync(tenantId, ct);
        await db.Notifications.Where(n => n.Id == id && n.Status == "pending").ExecuteUpdateAsync(s =>
        {
            s.SetProperty(n => n.Status, status);
            if (status == "sent") s.SetProperty(n => n.SentAt, DateTime.UtcNow);
        }, ct);
        await tx.CommitAsync(ct);
    }
}
