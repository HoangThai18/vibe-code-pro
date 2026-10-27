// Spa.Api/Jobs/ReminderJob.cs
using Microsoft.EntityFrameworkCore;
using Spa.Api.Data;
using Spa.Api.Tenancy;

namespace Spa.Api.Jobs;

public sealed record DueReminder(Guid Id, string Phone, string FullName, DateTime StartsAt, string TimeZone, bool Active);

// No HttpContext, no tenant: list tenants with app_tenant_ids(), then one scope and transaction per tenant
public sealed partial class ReminderJob(IServiceScopeFactory scopes, ISmsSender sms, ILogger<ReminderJob> log)
{
    public async Task RunOnceAsync(CancellationToken ct)
    {
        List<Guid> tenants;
        await using (var scope = scopes.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SpaDb>();
            tenants = await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM app_tenant_ids() AS id").ToListAsync(ct);
        }
        foreach (var tenantId in tenants)
        {
            try
            {
                await RunTenantAsync(tenantId, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogError(e, "Reminders failed for tenant {TenantId}", tenantId);   // the other tenants still run
            }
        }
    }

    async Task RunTenantAsync(Guid tenantId, CancellationToken ct)
    {
        List<DueReminder> due;
        await using (var scope = scopes.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SpaDb>();
            await using var tx = await db.BeginTenantAsync(tenantId, ct);
            // One row per appointment (UNIQUE + ON CONFLICT); the wide window catches up a missed scan
            await db.Database.ExecuteSqlAsync($"""
                INSERT INTO notifications (tenant_id, appointment_id, kind)
                SELECT tenant_id, id, 'reminder_24h' FROM appointments
                 WHERE status IN ('booked', 'confirmed')
                   AND starts_at > now() + interval '2 hours' AND starts_at <= now() + interval '24 hours'
                ON CONFLICT (tenant_id, appointment_id, kind) DO NOTHING
                """, ct);
            // Claim with a 5-minute lease: other instances skip the rows until they are marked or the lease runs out
            due = await db.Database.SqlQuery<DueReminder>($"""
                UPDATE notifications n SET locked_until = now() + interval '5 minutes'
                  FROM appointments a, customers c, tenants t
                 WHERE n.id IN (SELECT id FROM notifications
                                 WHERE status = 'pending' AND (locked_until IS NULL OR locked_until < now())
                                 ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED)
                   AND a.tenant_id = n.tenant_id AND a.id = n.appointment_id
                   AND c.tenant_id = a.tenant_id AND c.id = a.customer_id AND t.id = n.tenant_id
                RETURNING n.id, c.phone, c.full_name, a.starts_at, t.time_zone, a.status IN ('booked', 'confirmed') AS active
                """).ToListAsync(ct);
            await tx.CommitAsync(ct);
        }
        foreach (var r in due)
        {
            if (r.Active)
            {
                try
                {
                    await sms.SendAsync(r.Phone, ReminderText.For(r), r.Id, ct);   // outside any transaction
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    log.LogWarning(e, "Reminder {NotificationId} not sent", r.Id);
                    continue;
                }
            }
            await MarkAsync(tenantId, r.Id, r.Active ? "sent" : "skipped", ct);
        }
    }
}
