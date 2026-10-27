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

// Call at process startup; creates queues and schedules if missing
export async function setupQueues(boss: PgBoss, retry = { retryLimit: 5, retryDelay: 30 }): Promise<void> {
  await boss.createQueue(Q.sendReminderDead, { retentionSeconds: 30 * 24 * 3600 });
  await boss.createQueue(Q.sendReminder, {
    ...retry,                 // 5 retries, waiting 30s, 60s, 120s... (backoff with jitter), at most 1 hour
    retryBackoff: true,
    retryDelayMax: 3600,
    expireInSeconds: 120,     // a job running over 2 minutes counts as stuck: retry
    deadLetter: Q.sendReminderDead,
  });
  // singleton: one scan at a time, so a slow scan does not overlap the next
  await boss.createQueue(Q.enqueueReminders, { policy: 'singleton', retryLimit: 0 });
  await boss.schedule(Q.enqueueReminders, '*/10 * * * *', null, { tz: 'Asia/Ho_Chi_Minh' });
}
