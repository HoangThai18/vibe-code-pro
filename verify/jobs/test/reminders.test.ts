// test/reminders.test.ts — chạy với DB test thật: DATABASE_URL=postgres://... node --import tsx --test
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { withTenant } from '../src/db/tenant';
import { Q, setupQueues, type SendReminderJob } from '../src/jobs/queues';
import { enqueueReminders, sendReminder, type SmsSender } from '../src/jobs/reminders';
import { startWorker } from '../src/jobs/worker';

const url = process.env.DATABASE_URL!;
const pool = new pg.Pool({ connectionString: url });
const boss = new PgBoss(url);
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function fakeSms(failTimes = 0) {
  const sent: { to: string; text: string; idempotencyKey: string }[] = [];
  let failuresLeft = failTimes;
  const sms: SmsSender = {
    async send(message) {
      if (failuresLeft-- > 0) throw new Error('Nhà cung cấp SMS lỗi');
      sent.push(message);
    },
  };
  return { sms, sent };
}

async function seed(tenantId: string, rows: { name: string; inHours: number; status?: string }[]) {
  return withTenant(pool, tenantId, async (db) => {
    const ids: string[] = [];
    for (const r of rows) {
      const { rows: [row] } = await db.query<{ id: string }>(
        `INSERT INTO appointments (tenant_id, customer_name, customer_phone, starts_at, status)
         VALUES ($1, $2, '0912345678', now() + make_interval(hours => $3), $4) RETURNING id`,
        [tenantId, r.name, r.inHours, r.status ?? 'booked'],
      );
      ids.push(row!.id);
    }
    return ids;
  });
}

const notificationStatus = (tenantId: string) =>
  withTenant(pool, tenantId, async (db) => (await db.query<{ status: string }>('SELECT status FROM notifications')).rows.map((r) => r.status));

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 20_000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('Hết thời gian chờ');
    await new Promise((r) => setTimeout(r, 200));
  }
}

before(async () => {
  boss.on('error', console.error);
  await boss.start();
});
after(async () => {
  await boss.stop({ graceful: false });
  await pool.end();
});
beforeEach(async () => {
  await pool.query('TRUNCATE notifications, appointments');
  for (const name of Object.values(Q)) await boss.deleteQueue(name);
});

test('quét: chỉ lịch hẹn trong 2 đến 24 giờ tới, của mọi tenant, mỗi lịch một lần', async () => {
  await setupQueues(boss);
  await seed(A, [{ name: 'Lan', inHours: 10 }, { name: 'Sớm', inHours: 1 }, { name: 'Xa', inHours: 30 }, { name: 'Huỷ', inHours: 20, status: 'cancelled' }]);
  await seed(B, [{ name: 'Minh', inHours: 5 }]);

  assert.equal(await enqueueReminders(pool, boss), 2);
  assert.equal(await enqueueReminders(pool, boss), 0);          // chạy lại: không nhắc trùng
  const jobs = await boss.fetch<SendReminderJob>(Q.sendReminder, { batchSize: 10 });
  assert.deepEqual(jobs.map((j) => j.data.tenantId).sort(), [A, B]);
});

test('transaction rollback thì job cũng không tồn tại', async () => {
  await setupQueues(boss);
  await assert.rejects(
    withTenant(pool, A, async (db) => {
      await boss.send(Q.sendReminder, { tenantId: A, notificationId: 'x' }, { db: { executeSql: (t, v) => db.query(t, v) } });
      throw new Error('lỗi nghiệp vụ sau khi xếp job');
    }),
  );
  assert.equal((await boss.fetch(Q.sendReminder)).length, 0);
});

test('worker gửi đúng một tin; chạy lại job cũng không gửi lại', async () => {
  const { sms, sent } = fakeSms();
  await seed(A, [{ name: 'Lan', inHours: 10 }]);
  const worker = await startWorker({ databaseUrl: url, sms, pollingIntervalSeconds: 0.5 });
  try {
    await enqueueReminders(pool, worker.boss);
    await waitFor(async () => (await notificationStatus(A))[0] === 'sent');
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.text, /Chào Lan, nhắc lịch hẹn của bạn lúc/);
    const { rows: [n] } = await withTenant(pool, A, (db) => db.query<{ id: string }>('SELECT id FROM notifications'));
    assert.equal(sent[0]!.idempotencyKey, n!.id);
    assert.equal(await sendReminder(pool, sms, { tenantId: A, notificationId: n!.id }), 'skipped');
    assert.equal(sent.length, 1);
  } finally {
    await worker.stop();
  }
});

test('nhà cung cấp lỗi thì thử lại; hết lượt thì job vào dead letter', async () => {
  const flaky = fakeSms(1);
  await seed(A, [{ name: 'Lan', inHours: 10 }]);
  let worker = await startWorker({ databaseUrl: url, sms: flaky.sms, pollingIntervalSeconds: 0.5, retry: { retryLimit: 2, retryDelay: 1 } });
  try {
    await enqueueReminders(pool, worker.boss);
    await waitFor(() => flaky.sent.length === 1);                 // lỗi lần đầu, lần thử lại thành công
  } finally {
    await worker.stop();
  }

  await pool.query('TRUNCATE notifications, appointments');
  const down = fakeSms(100);
  await seed(B, [{ name: 'Minh', inHours: 10 }]);
  worker = await startWorker({ databaseUrl: url, sms: down.sms, pollingIntervalSeconds: 0.5, retry: { retryLimit: 1, retryDelay: 1 } });
  try {
    await enqueueReminders(pool, worker.boss);
    await waitFor(async () => (await boss.fetch(Q.sendReminderDead)).length === 1);
    assert.deepEqual(await notificationStatus(B), ['pending']);    // chưa gửi: xử lý tay rồi redrive
    assert.equal(down.sent.length, 0);
  } finally {
    await worker.stop();
  }
});

test('id của tenant khác hoặc lịch đã huỷ thì không gửi', async () => {
  await setupQueues(boss);
  const { sms, sent } = fakeSms();
  const [appointmentId] = await seed(A, [{ name: 'Lan', inHours: 10 }]);
  await enqueueReminders(pool, boss);
  const { rows: [n] } = await withTenant(pool, A, (db) => db.query<{ id: string }>('SELECT id FROM notifications'));

  assert.equal(await sendReminder(pool, sms, { tenantId: B, notificationId: n!.id }), 'skipped');   // RLS: B không thấy
  await withTenant(pool, A, (db) => db.query("UPDATE appointments SET status = 'cancelled' WHERE id = $1", [appointmentId]));
  assert.equal(await sendReminder(pool, sms, { tenantId: A, notificationId: n!.id }), 'skipped');
  assert.deepEqual(await notificationStatus(A), ['skipped']);
  assert.equal(sent.length, 0);
});

test('lịch quét chạy mỗi 10 phút theo giờ Việt Nam', async () => {
  await setupQueues(boss);
  const [schedule] = await boss.getSchedules(Q.enqueueReminders);
  assert.equal(schedule?.cron, '*/10 * * * *');
  assert.equal(schedule?.timezone, 'Asia/Ho_Chi_Minh');
});
