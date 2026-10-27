// apps/api/src/jobs/queues.ts
import { PgBoss } from 'pg-boss';

export const Q = {
  enqueueReminders: 'enqueue-reminders',
  sendReminder: 'send-reminder',
  sendReminderDead: 'send-reminder-dead',
} as const;

export interface SendReminderJob {
  tenantId: string;
  notificationId: string;
}

// Gọi lúc process khởi động; tạo queue và lịch nếu chưa có
export async function setupQueues(boss: PgBoss, retry = { retryLimit: 5, retryDelay: 30 }): Promise<void> {
  await boss.createQueue(Q.sendReminderDead, { retentionSeconds: 30 * 24 * 3600 });
  await boss.createQueue(Q.sendReminder, {
    ...retry,                 // thử lại 5 lần, chờ 30s, 60s, 120s... (backoff có jitter), tối đa 1 giờ
    retryBackoff: true,
    retryDelayMax: 3600,
    expireInSeconds: 120,     // job chạy quá 2 phút coi như treo: thử lại
    deadLetter: Q.sendReminderDead,
  });
  // singleton: mỗi lúc chỉ một lần quét chạy, lần quét chậm không chồng lên lần sau
  await boss.createQueue(Q.enqueueReminders, { policy: 'singleton', retryLimit: 0 });
  await boss.schedule(Q.enqueueReminders, '*/10 * * * *', null, { tz: 'Asia/Ho_Chi_Minh' });
}
