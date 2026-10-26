# Background jobs: queues, retries, schedules

The code and SQL below ran with pg-boss 12.38, node-postgres, PostgreSQL 16 with RLS (`FORCE`), and an app role that does not bypass RLS. Removing any single protection (UNIQUE + `ON CONFLICT`, the `status = 'pending'` check, the cancelled-appointment check, the lower bound of the time window) made a test fail every time.

## Contents
1. When you need a background job
2. Choosing a tool
3. Example: appointment reminder 24 hours ahead
4. Rules for every job
5. Tests
6. Operations

## 1. When you need a background job

- Slow work or external calls the user need not wait for: sending email/SMS/Zalo, calling webhooks, generating export files, bulk AI calls.
- Work that must happen even after the request has returned: sending the invoice after payment, syncing to another system.
- Scheduled work: appointment reminders, nightly report rollups, purging expired data.

The DB write and the enqueue must be in **the same transaction** (outbox pattern, `data-layer.md`): on commit the job is guaranteed to exist; on rollback there is no "ghost" job messaging about an order that does not exist.

## 2. Choosing a tool

| You have | Use | Notes |
|---|---|---|
| PostgreSQL, Node | pg-boss | Jobs live in your existing DB, can be enqueued in the same transaction, no new system to operate |
| PostgreSQL, Rails / Elixir / Python | Solid Queue or GoodJob / Oban / Procrastinate | Same idea |
| Redis already in place, very high volume | BullMQ, Sidekiq, Celery | Faster, but enqueueing is not in the same transaction as the DB: needs an outbox table |
| Cloud | SQS, Cloud Tasks, Cloud Scheduler | Good fit when already serverless |

Default to a queue on your existing DB. Move to Redis or a dedicated queue when you measure the DB as the bottleneck (the `vibe-ship` skill, `references/performance.md`), not before.

## 3. Example: appointment reminder 24 hours ahead

A scheduled job scans every 10 minutes, creates a `notifications` row and enqueues one send job per appointment that needs a reminder. The worker sends the message; on error it retries with backoff, and when retries run out the job goes to a dead letter queue.

```sql
CREATE TABLE notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  appointment_id uuid NOT NULL REFERENCES appointments (id),
  kind           text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  sent_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, kind)            -- one reminder of each kind per appointment
);
CREATE INDEX notifications_tenant ON notifications (tenant_id);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
```

```ts
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
```

```ts
// apps/api/src/jobs/reminders.ts
import type { PgBoss } from 'pg-boss';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant';
import { Q, type SendReminderJob } from './queues';

export interface SmsSender {
  // SMS/Zalo provider accepts idempotencyKey: resending with the same key sends no second message
  send(input: { to: string; text: string; idempotencyKey: string }): Promise<void>;
}

// pg-boss writes the job using your own transaction: the job exists only if the transaction commits
const inTx = (db: PoolClient) => ({ db: { executeSql: (text: string, values?: unknown[]) => db.query(text, values) } });

// Scheduled job: find appointments to remind in each tenant (keeping RLS), create notification + send job in one transaction
export async function enqueueReminders(pool: Pool, boss: PgBoss): Promise<number> {
  const { rows: tenants } = await pool.query<{ id: string }>('SELECT id FROM tenants');
  let queued = 0;
  for (const tenant of tenants) {
    queued += await withTenant(pool, tenant.id, async (db) => {
      // Wide window (next 2 to 24 hours) + UNIQUE: a missed scan is caught up, no double reminders
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

// Worker: however many times it reruns, it sends one message
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
  if (!row || row.status !== 'pending') return 'skipped';   // already sent, skipped, or not in this tenant (RLS)
  if (!row.booked) {
    await setStatus(pool, job, 'skipped');                    // appointment cancelled after the job was enqueued
    return 'skipped';
  }

  const when = row.starts_at.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' });
  // The external call is NOT inside a DB transaction; on error, throw so pg-boss retries
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
```

```ts
// apps/api/src/jobs/worker.ts — separate process: node dist/jobs/worker.js
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
  boss.on('error', (err) => console.error('pg-boss', err));   // use the project's logger
  await boss.start();
  await setupQueues(boss, opts.retry);

  const polling = { pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 2 };
  await boss.work(Q.enqueueReminders, polling, async () => {
    await enqueueReminders(pool, boss);
  });
  await boss.work<SendReminderJob>(Q.sendReminder, { ...polling, localConcurrency: 5 }, async ([job]) => {
    await sendReminder(pool, opts.sms, job!.data);
  });

  // Deploy sends SIGTERM: stop taking jobs, wait for running jobs to finish (max 30s), then exit
  const stop = async () => {
    await boss.stop({ graceful: true, timeout: 30_000 });
    await pool.end();
  };
  process.once('SIGTERM', () => void stop());
  return { boss, pool, stop };
}
```

`withTenant` comes from `postgres-rls.md` section 4. The app role needs permission to create the `pgboss` schema on first run (or run pg-boss migrations with the `pg-boss` CLI in the CI migrate step and grant only usage); pg-boss tables do not belong to a tenant, so they have no RLS.

Why it is written this way:

- **Scan per tenant, inside `withTenant`**: a job has no request, so no tenant at hand; looping over tenants keeps RLS without a bypass role. Fine for thousands of tenants; beyond that, scan with a maintenance role and enqueue jobs carrying `tenantId`.
- **Jobs carry only ids** (`tenantId`, `notificationId`), no phone number or message text: data is reread at run time, so it is always fresh (cancelled appointment, no message), and it is not scattered across the job table.
- **Call the provider outside the transaction**, update the status afterwards. If the process dies between the two steps, the retry resends with the same `idempotencyKey`: if the provider supports that key, there is no duplicate; if not, accept a rare duplicate message, or add a `sending` status and have a person check jobs stuck in it.

## 4. Rules for every job

1. **Idempotent**: running twice gives the same result as running once. Every queue sometimes delivers a job twice (worker dies, `expireInSeconds` runs out).
2. **Small payload with `tenantId`**; read the latest data at run time. When the payload shape changes, the new worker must still read old payloads left in the queue.
3. **Bounded retries with backoff**; for errors that will not fix themselves (bad data, 4xx from an external API), do not retry pointlessly: mark as skipped and log, or send straight to dead letter.
4. **Have a dead letter queue and alert when it has jobs.** Jobs there need a person: fix the cause, then rerun (`boss.redrive(...)`).
5. **Timeouts on every external call**, shorter than the queue's `expireInSeconds`, so a job that is still running is not treated as stuck.
6. **Graceful shutdown on deploy**: on `SIGTERM`, stop taking new jobs and wait for running jobs to finish (`boss.stop({ graceful: true })`).
7. **Scheduled jobs do not overlap**: `singleton` queue or a lock; and they tolerate a missed run (wide time window + UNIQUE constraint, as in the example).
8. **Times in the business time zone** (`tz: 'Asia/Ho_Chi_Minh'`), not server time.

## 5. Tests

Test with a real DB (as in `isolation-tests.md`), a real worker and a fake SMS provider:

```ts
// test/reminders.test.ts — run against a real test DB: DATABASE_URL=postgres://... node --import tsx --test
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

test('scan: only appointments 2 to 24 hours ahead, across all tenants, once each', async () => {
  await setupQueues(boss);
  await seed(A, [{ name: 'Lan', inHours: 10 }, { name: 'Sớm', inHours: 1 }, { name: 'Xa', inHours: 30 }, { name: 'Huỷ', inHours: 20, status: 'cancelled' }]);
  await seed(B, [{ name: 'Minh', inHours: 5 }]);

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

test('worker sends exactly one message; rerunning the job does not resend', async () => {
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

  await pool.query('TRUNCATE notifications, appointments');
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

test('scan schedule runs every 10 minutes in Vietnam time', async () => {
  await setupQueues(boss);
  const [schedule] = await boss.getSchedules(Q.enqueueReminders);
  assert.equal(schedule?.cron, '*/10 * * * *');
  assert.equal(schedule?.timezone, 'Asia/Ho_Chi_Minh');
});
```

- Run serially (`--test-concurrency=1`) because the tests share the DB and queues.
- `pollingIntervalSeconds: 0.5` and short retries are for tests only, to keep them fast.

## 6. Operations

- Run the worker as a separate process (same image as the API, different start command) to scale and deploy it independently; the API only enqueues.
- Monitor (the `vibe-ship` skill, `references/observability.md`): waiting jobs per queue (`boss.getQueue(name)` has `queuedCount`, `activeCount`, `failedCount`), wait time of the oldest job, error rate, jobs in dead letter. Alert when a queue keeps growing or dead letter is non-zero.
- pg-boss deletes completed jobs after `deleteAfterSeconds` (default 7 days); watch the job table size at high volume.
- To disable a job type during an incident: `boss.offWork(name)` or a config flag, then re-enqueue later.
