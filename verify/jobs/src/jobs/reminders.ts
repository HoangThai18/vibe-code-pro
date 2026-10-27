// apps/api/src/jobs/reminders.ts
import type { PgBoss } from 'pg-boss';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant';
import { formatDateTime } from '../i18n/format';
import { removeDiacritics } from '../i18n/text';
import { Q, type SendReminderJob } from './queues';

export interface SmsSender {
  // SMS/Zalo provider accepts idempotencyKey: resending with the same key sends no second message
  send(input: { to: string; text: string; idempotencyKey: string }): Promise<void>;
}

// pg-boss writes the job using your own transaction: the job exists only if the transaction commits
const inTx = (db: PoolClient) => ({ db: { executeSql: (text: string, values?: unknown[]) => db.query(text, values) } });

// Scheduled job: in each active tenant (keeping RLS), create notification + send job in one transaction.
// app_tenant_ids(), not SELECT FROM tenants: a worker has no tenant, so RLS would show it 0 tenants.
export async function enqueueReminders(pool: Pool, boss: PgBoss): Promise<number> {
  const { rows: tenants } = await pool.query<{ id: string }>('SELECT id FROM app_tenant_ids() AS id');
  let queued = 0;
  for (const tenant of tenants) {
    queued += await withTenant(pool, tenant.id, async (db) => {
      // Wide window (next 2 to 24 hours) + UNIQUE: a missed scan is caught up, no double reminders
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO notifications (tenant_id, appointment_id, kind)
         SELECT tenant_id, id, 'reminder_24h' FROM appointments
          WHERE status IN ('booked', 'confirmed')
            AND starts_at >  now() + interval '2 hours'
            AND starts_at <= now() + interval '24 hours'
         ON CONFLICT (tenant_id, appointment_id, kind) DO NOTHING
         RETURNING id`,
      );
      for (const n of rows) {
        await boss.send(Q.sendReminder, { tenantId: tenant.id, notificationId: n.id } satisfies SendReminderJob, inTx(db));
      }
      return rows.length;
    });
  }
  return queued;
}

// Worker: however many times it reruns, it sends one message
export async function sendReminder(pool: Pool, sms: SmsSender, job: SendReminderJob): Promise<'sent' | 'skipped'> {
  const row = await withTenant(pool, job.tenantId, async (db) => {
    // Name and phone come from customers at send time: a correction or deletion request applies to queued reminders too
    const { rows } = await db.query<{ status: string; active: boolean; phone: string; full_name: string; starts_at: Date; time_zone: string }>(
      `SELECT n.status, a.status IN ('booked', 'confirmed') AS active, c.phone, c.full_name, a.starts_at, t.time_zone
         FROM notifications n
         JOIN appointments a ON a.tenant_id = n.tenant_id AND a.id = n.appointment_id
         JOIN customers c ON c.tenant_id = a.tenant_id AND c.id = a.customer_id
         JOIN tenants t ON t.id = n.tenant_id
        WHERE n.id = $1`,
      [job.notificationId],
    );
    return rows[0];
  });
  if (!row || row.status !== 'pending') return 'skipped';   // already sent, skipped, or not in this tenant (RLS)
  if (!row.active) {
    await setStatus(pool, job, 'skipped');                    // appointment cancelled after the job was enqueued
    return 'skipped';
  }

  // Customer-care brandname SMS: the text must match a template registered with the carriers, without diacritics
  // (references/notifications.md section 5). The time is in the tenant's zone, never the server's.
  const when = formatDateTime(row.starts_at, { locale: 'vi', timeZone: row.time_zone });
  const text = `Chao ${removeDiacritics(row.full_name)}, nhac lich hen cua ban luc ${when}.`;
  // The external call is NOT inside a DB transaction; on error, throw so pg-boss retries
  await sms.send({ to: row.phone, text, idempotencyKey: job.notificationId });
  await setStatus(pool, job, 'sent');
  return 'sent';
}

function setStatus(pool: Pool, job: SendReminderJob, status: 'sent' | 'skipped') {
  return withTenant(pool, job.tenantId, (db) =>
    db.query(
      `UPDATE notifications SET status = $2, sent_at = CASE WHEN $2 = 'sent' THEN now() END
        WHERE id = $1 AND status = 'pending'`,
      [job.notificationId, status],
    ),
  );
}
