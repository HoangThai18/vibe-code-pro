// apps/api/src/jobs/worker.ts — process riêng: node dist/jobs/worker.js
import { PgBoss } from 'pg-boss';
import pg from 'pg';
import { Q, setupQueues, type SendReminderJob } from './queues';
import { enqueueReminders, sendReminder, type SmsSender } from './reminders';

export async function startWorker(opts: {
  databaseUrl: string;
  sms: SmsSender;
  pollingIntervalSeconds?: number;
  retry?: { retryLimit: number; retryDelay: number };
}) {
  const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 10 });
  const boss = new PgBoss(opts.databaseUrl);
  boss.on('error', (err) => console.error('pg-boss', err));   // dùng logger của dự án
  await boss.start();
  await setupQueues(boss, opts.retry);

  const polling = { pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 2 };
  await boss.work(Q.enqueueReminders, polling, async () => {
    await enqueueReminders(pool, boss);
  });
  await boss.work<SendReminderJob>(Q.sendReminder, { ...polling, localConcurrency: 5 }, async ([job]) => {
    await sendReminder(pool, opts.sms, job!.data);
  });

  // Deploy gửi SIGTERM: nhận thêm job thì dừng, chờ job đang chạy xong (tối đa 30s) rồi mới thoát
  const stop = async () => {
    await boss.stop({ graceful: true, timeout: 30_000 });
    await pool.end();
  };
  process.once('SIGTERM', () => void stop());
  return { boss, pool, stop };
}
