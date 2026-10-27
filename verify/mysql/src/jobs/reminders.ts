// src/jobs/reminders.ts — the reminder of references/jobs.md on MySQL: same rules, no RLS, no RETURNING
import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { errno, withTenant } from '../db/tenant';
import { claim } from './claim';
import { enqueue, finish } from './queue';

export const SEND_REMINDER = 'send-reminder';
export interface SendReminderJob { notificationId: string }
export interface SmsSender { send(input: { to: string; text: string; idempotencyKey: string }): Promise<void> }

// Scheduled every 10 minutes. Without RLS a plain SELECT lists tenants; everything after it filters by tenant_id.
export async function enqueueReminders(pool: Pool): Promise<number> {
  const [tenants] = await pool.query<RowDataPacket[]>("SELECT id FROM tenants WHERE status = 'active' ORDER BY id");
  let queued = 0;
  for (const t of tenants) {
    queued += await withTenant(pool, t.id, async (db) => {
      const [due] = await db.conn.query<RowDataPacket[]>(
        `SELECT a.id FROM appointments a
          WHERE a.tenant_id = ? AND a.status IN ('booked', 'confirmed')
            AND a.starts_at > UTC_TIMESTAMP(3) + INTERVAL 2 HOUR AND a.starts_at <= UTC_TIMESTAMP(3) + INTERVAL 24 HOUR
            AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.tenant_id = a.tenant_id
                              AND n.appointment_id = a.id AND n.kind = 'reminder_24h')`, [db.tenantId]);
      let n = 0;
      for (const a of due) {
        const id = randomUUID();
        try {
          // Not INSERT IGNORE: it also turns FK failures and truncation into warnings
          await db.conn.query(
            "INSERT INTO notifications (tenant_id, id, appointment_id, kind) VALUES (?, ?, ?, 'reminder_24h')",
            [db.tenantId, id, a.id]);
        } catch (err) {
          if (errno(err) === 1062) continue;   // a concurrent scan created it; only this statement was undone
          throw err;
        }
        await enqueue(db.conn, db.tenantId, SEND_REMINDER, { notificationId: id } satisfies SendReminderJob);
        n++;
      }
      return n;
    });
  }
  return queued;
}

// One send per notification, however many times the job runs
export async function sendReminder(pool: Pool, sms: SmsSender, tenantId: string, job: SendReminderJob): Promise<'sent' | 'skipped'> {
  const row = await withTenant(pool, tenantId, async (db) => {
    const [rows] = await db.conn.query<RowDataPacket[]>(
      `SELECT n.status, a.status IN ('booked', 'confirmed') AS active, c.phone
         FROM notifications n
         JOIN appointments a ON a.tenant_id = n.tenant_id AND a.id = n.appointment_id
         JOIN customers c ON c.tenant_id = a.tenant_id AND c.id = a.customer_id
        WHERE n.tenant_id = ? AND n.id = ?`, [db.tenantId, job.notificationId]);
    return rows[0];
  });
  if (!row || row.status !== 'pending') return 'skipped';   // sent already, or not in this tenant
  const status = row.active ? 'sent' : 'skipped';
  // Text and time formatting: references/jobs.md. The phone is read at send time, never copied into the job.
  if (row.active) await sms.send({ to: row.phone, text: 'Nhac lich hen ngay mai', idempotencyKey: job.notificationId });
  await withTenant(pool, tenantId, (db) => db.conn.query(
    `UPDATE notifications SET status = ?, sent_at = IF(? = 'sent', UTC_TIMESTAMP(3), NULL)
      WHERE tenant_id = ? AND id = ? AND status = 'pending'`, [status, status, db.tenantId, job.notificationId]));
  return status;
}

export async function workOnce(pool: Pool, sms: SmsSender): Promise<number> {
  const jobs = await claim<SendReminderJob>(pool, SEND_REMINDER);
  for (const job of jobs) {
    try {
      await sendReminder(pool, sms, job.tenantId, job.payload);
      await finish(pool, job);
    } catch (err) {
      await finish(pool, job, err);
    }
  }
  return jobs.length;
}
