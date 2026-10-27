// apps/api/src/jobs/reminders.ts
import type { PgBoss } from 'pg-boss';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant';
import { Q, type SendReminderJob } from './queues';

export interface SmsSender {
  // Nhà cung cấp SMS/Zalo nhận idempotencyKey: gửi lại cùng key thì không gửi tin thứ hai
  send(input: { to: string; text: string; idempotencyKey: string }): Promise<void>;
}

// pg-boss ghi job bằng chính transaction của bạn: job chỉ tồn tại nếu transaction commit
const inTx = (db: PoolClient) => ({ db: { executeSql: (text: string, values?: unknown[]) => db.query(text, values) } });

// Job theo lịch: tìm lịch hẹn cần nhắc ở từng tenant (giữ RLS), tạo notification + job gửi cùng một transaction
export async function enqueueReminders(pool: Pool, boss: PgBoss): Promise<number> {
  const { rows: tenants } = await pool.query<{ id: string }>('SELECT id FROM tenants');
  let queued = 0;
  for (const tenant of tenants) {
    queued += await withTenant(pool, tenant.id, async (db) => {
      // Cửa sổ rộng (2 đến 24 giờ tới) + UNIQUE: lần quét bị lỡ vẫn bù được, không nhắc hai lần
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO notifications (tenant_id, appointment_id, kind)
         SELECT tenant_id, id, 'reminder_24h' FROM appointments
          WHERE status = 'booked'
            AND starts_at >  now() + interval '2 hours'
            AND starts_at <= now() + interval '24 hours'
         ON CONFLICT (appointment_id, kind) DO NOTHING
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

// Worker: chạy lại bao nhiêu lần cũng chỉ gửi một tin
export async function sendReminder(pool: Pool, sms: SmsSender, job: SendReminderJob): Promise<'sent' | 'skipped'> {
  const row = await withTenant(pool, job.tenantId, async (db) => {
    const { rows } = await db.query<{ status: string; booked: boolean; phone: string; name: string; starts_at: Date }>(
      `SELECT n.status, a.status = 'booked' AS booked, a.customer_phone AS phone, a.customer_name AS name, a.starts_at
         FROM notifications n JOIN appointments a ON a.id = n.appointment_id
        WHERE n.id = $1`,
      [job.notificationId],
    );
    return rows[0];
  });
  if (!row || row.status !== 'pending') return 'skipped';   // đã gửi, đã bỏ, hoặc không thuộc tenant này (RLS)
  if (!row.booked) {
    await setStatus(pool, job, 'skipped');                    // lịch đã huỷ sau khi xếp job
    return 'skipped';
  }

  const when = row.starts_at.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' });
  // Gọi ra ngoài KHÔNG nằm trong transaction DB; lỗi thì ném ra để pg-boss thử lại
  await sms.send({ to: row.phone, text: `Chào ${row.name}, nhắc lịch hẹn của bạn lúc ${when}.`, idempotencyKey: job.notificationId });
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
