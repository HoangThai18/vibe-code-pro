// test/reminders.test.ts — run against a real test DB: verify/tools/run.sh jobs
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { withTenant } from '../src/db/tenant';
import { Q, setupQueues, type SendReminderJob } from '../src/jobs/queues';
import { enqueueReminders, sendReminder, type SmsSender } from '../src/jobs/reminders';
import { startWorker } from '../src/jobs/worker';
import { setupDatabase } from './setup-db';

const url = process.env.DATABASE_URL!;
setupDatabase(url);
// Everything below (pools, pg-boss, the worker) runs as app_user: no BYPASSRLS, tenants under FORCE RLS
process.env.PGOPTIONS = '-c role=app_user';
const admin = new pg.Pool({ connectionString: url, options: '-c client_min_messages=warning' });
const pool = new pg.Pool({ connectionString: url });
const boss = new PgBoss(url);
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';   // suspended
const STAFF = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

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

let phone = 912000000;
async function seed(tenantId: string, rows: { name: string; inHours: number; status?: string }[]) {
  return withTenant(pool, tenantId, async (db) => {
    const ids: string[] = [];
    for (const r of rows) {
      const { rows: [c] } = await db.query<{ id: string }>(
        'INSERT INTO customers (full_name, phone) VALUES ($1, $2) RETURNING id', [r.name, `0${phone++}`]);
      const { rows: [row] } = await db.query<{ id: string }>(
        `INSERT INTO appointments (customer_id, staff_user_id, starts_at, ends_at, status)
         VALUES ($1, $2, now() + make_interval(hours => $3), now() + make_interval(hours => $3 + 1), $4) RETURNING id`,
        [c!.id, STAFF, r.inHours, r.status ?? 'booked'],
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
  // Tenants, users and memberships come from sign-up in a real app; here the superuser seeds them
  await admin.query(`INSERT INTO tenants (id, name, time_zone, status) VALUES
    ($1, 'Spa A', 'Asia/Ho_Chi_Minh', 'active'), ($2, 'Spa B', 'Asia/Tokyo', 'active'), ($3, 'Spa C', 'Asia/Ho_Chi_Minh', 'suspended')`, [A, B, C]);
  await admin.query("INSERT INTO users (id, email) VALUES ($1, 'nhanvien@example.com')", [STAFF]);
  await admin.query("INSERT INTO memberships (tenant_id, user_id, role) SELECT t, $1, 'staff' FROM unnest($2::uuid[]) t", [STAFF, [A, B, C]]);
  boss.on('error', console.error);
  await boss.start();
});
after(async () => {
  await boss.stop({ graceful: false });
  await Promise.all([pool.end(), admin.end()]);
});
beforeEach(async () => {
  await admin.query('TRUNCATE notifications, appointments, customers');
  for (const name of Object.values(Q)) await boss.deleteQueue(name);
});

test('the worker role sees no tenants through SELECT; app_tenant_ids() lists the active ones', async () => {
  assert.equal((await pool.query('SELECT id FROM tenants')).rowCount, 0);
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM app_tenant_ids() AS id');
  assert.deepEqual(rows.map((r) => r.id), [A, B]);
});

test('scan: only appointments 2 to 24 hours ahead, in active tenants, once each', async () => {
  await setupQueues(boss);
  await seed(A, [{ name: 'Lan', inHours: 10 }, { name: 'Sớm', inHours: 1 }, { name: 'Xa', inHours: 30 }, { name: 'Huỷ', inHours: 20, status: 'cancelled' }]);
  await seed(B, [{ name: 'Minh', inHours: 5 }]);
  await seed(C, [{ name: 'Tạm ngưng', inHours: 5 }]);

  assert.equal(await enqueueReminders(pool, boss), 2);
  assert.equal(await enqueueReminders(pool, boss), 0);          // rerun: no duplicate reminders
  const jobs = await boss.fetch<SendReminderJob>(Q.sendReminder, { batchSize: 10 });
  assert.deepEqual(jobs.map((j) => j.data.tenantId).sort(), [A, B]);
});

test('transaction rollback leaves no job', async () => {
  await setupQueues(boss);
  await assert.rejects(
    withTenant(pool, A, async (db) => {
      await boss.send(Q.sendReminder, { tenantId: A, notificationId: 'x' }, { db: { executeSql: (t, v) => db.query(t, v) } });
      throw new Error('lỗi nghiệp vụ sau khi xếp job');
    }),
  );
  assert.equal((await boss.fetch(Q.sendReminder)).length, 0);
});

test('worker sends exactly one unaccented message in the tenant\'s time zone; rerunning does not resend', async () => {
  const { sms, sent } = fakeSms();
  await seed(B, [{ name: 'Đặng Thị Ánh', inHours: 10 }]);
  const worker = await startWorker({ databaseUrl: url, sms, pollingIntervalSeconds: 0.5 });
  try {
    await enqueueReminders(pool, worker.boss);
    await waitFor(async () => (await notificationStatus(B))[0] === 'sent');
    assert.equal(sent.length, 1);
    const { rows: [a] } = await admin.query<{ starts_at: Date }>('SELECT starts_at FROM appointments');
    const tokyo = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(a!.starts_at);
    assert.match(sent[0]!.text, new RegExp(`^Chao Dang Thi Anh, nhac lich hen cua ban luc ${tokyo} \\d{2}/\\d{2}/\\d{4}\\.$`));
    assert.match(sent[0]!.text, /^[\x20-\x7e]+$/);                // GSM-7 safe: 160 characters per SMS, not 70
    const { rows: [n] } = await withTenant(pool, B, (db) => db.query<{ id: string }>('SELECT id FROM notifications'));
    assert.equal(sent[0]!.idempotencyKey, n!.id);
    assert.equal(await sendReminder(pool, sms, { tenantId: B, notificationId: n!.id }), 'skipped');
    assert.equal(sent.length, 1);
  } finally {
    await worker.stop();
  }
});

test('the message uses the customer\'s data at send time, not a copy taken at enqueue', async () => {
  await setupQueues(boss);
  const { sms, sent } = fakeSms();
  await seed(A, [{ name: 'Lan', inHours: 10 }]);
  await enqueueReminders(pool, boss);
  await withTenant(pool, A, (db) => db.query("UPDATE customers SET full_name = 'Nguyễn Thị Lan', phone = '0987654321'"));
  const { rows: [n] } = await withTenant(pool, A, (db) => db.query<{ id: string }>('SELECT id FROM notifications'));
  assert.equal(await sendReminder(pool, sms, { tenantId: A, notificationId: n!.id }), 'sent');
  assert.match(sent[0]!.text, /^Chao Nguyen Thi Lan,/);
  assert.equal(sent[0]!.to, '0987654321');
});

test('provider error is retried; when retries run out the job goes to dead letter', async () => {
  const flaky = fakeSms(1);
  await seed(A, [{ name: 'Lan', inHours: 10 }]);
  let worker = await startWorker({ databaseUrl: url, sms: flaky.sms, pollingIntervalSeconds: 0.5, retry: { retryLimit: 2, retryDelay: 1 } });
  try {
    await enqueueReminders(pool, worker.boss);
    await waitFor(() => flaky.sent.length === 1);                 // first attempt fails, the retry succeeds
  } finally {
    await worker.stop();
  }

  await admin.query('TRUNCATE notifications, appointments, customers');
  const down = fakeSms(100);
  await seed(B, [{ name: 'Minh', inHours: 10 }]);
  worker = await startWorker({ databaseUrl: url, sms: down.sms, pollingIntervalSeconds: 0.5, retry: { retryLimit: 1, retryDelay: 1 } });
  try {
    await enqueueReminders(pool, worker.boss);
    await waitFor(async () => (await boss.fetch(Q.sendReminderDead)).length === 1);
    assert.deepEqual(await notificationStatus(B), ['pending']);    // not sent: handle manually, then redrive
    assert.equal(down.sent.length, 0);
  } finally {
    await worker.stop();
  }
});

test('no message for an id from another tenant or a cancelled appointment', async () => {
  await setupQueues(boss);
  const { sms, sent } = fakeSms();
  const [appointmentId] = await seed(A, [{ name: 'Lan', inHours: 10 }]);
  await enqueueReminders(pool, boss);
  const { rows: [n] } = await withTenant(pool, A, (db) => db.query<{ id: string }>('SELECT id FROM notifications'));

  assert.equal(await sendReminder(pool, sms, { tenantId: B, notificationId: n!.id }), 'skipped');   // RLS: B cannot see it
  await withTenant(pool, A, (db) => db.query("UPDATE appointments SET status = 'cancelled' WHERE id = $1", [appointmentId]));
  assert.equal(await sendReminder(pool, sms, { tenantId: A, notificationId: n!.id }), 'skipped');
  assert.deepEqual(await notificationStatus(A), ['skipped']);
  assert.equal(sent.length, 0);
});

test('a notification cannot point at another tenant\'s appointment (composite FK)', async () => {
  const [bAppointment] = await seed(B, [{ name: 'Minh', inHours: 10 }]);
  await assert.rejects(
    withTenant(pool, A, (db) => db.query("INSERT INTO notifications (appointment_id, kind) VALUES ($1, 'reminder_24h')", [bAppointment])),
    { code: '23503' },
  );
});

test('scan schedule runs every 10 minutes in Vietnam time', async () => {
  await setupQueues(boss);
  const [schedule] = await boss.getSchedules(Q.enqueueReminders);
  assert.equal(schedule?.cron, '*/10 * * * *');
  assert.equal(schedule?.timezone, 'Asia/Ho_Chi_Minh');
});
