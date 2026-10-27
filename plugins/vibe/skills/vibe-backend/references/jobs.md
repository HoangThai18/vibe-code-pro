# Background jobs: queues, retries, schedules

The code and SQL below ran with pg-boss 12.38, node-postgres, PostgreSQL 16 with FORCE RLS on every tenant table including `tenants`, and an app role that does not bypass RLS, from an empty database. Removing any single protection (UNIQUE + `ON CONFLICT`, the `status = 'pending'` check, the cancelled-appointment check, the lower bound of the time window, `app_tenant_ids()`, the tenant's time zone) made a test fail.

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
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL,
  kind           text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  sent_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, appointment_id, kind)          -- one reminder of each kind per appointment
);
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

`withTenant` and `app_tenant_ids()` come from `postgres-rls.md` sections 3 and 4; `formatDateTime` and `removeDiacritics` from the shared formatting module (the `vibe-frontend` skill, `references/i18n.md`). The app role needs permission to create the `pgboss` schema on first run (or run pg-boss migrations with the `pg-boss` CLI in the CI migrate step and grant only usage); pg-boss tables do not belong to a tenant, so they have no RLS.

Why it is written this way:

- **List tenants with `app_tenant_ids()`, then work inside `withTenant`**: a job has no request, so no tenant at hand, and the `tenants` policy shows it 0 rows: `SELECT id FROM tenants` returns nothing and the job silently sends nothing. The function is the one cross-tenant read; everything else keeps RLS. Fine for thousands of tenants; beyond that, scan with a maintenance role and enqueue jobs carrying `tenantId`. Every "for each tenant" job (payment expiry, privacy request deadlines, purges) follows the same loop.
- **Jobs carry only ids** (`tenantId`, `notificationId`), no phone number or message text: data is reread at run time, joined from `customers`, so it is always fresh (cancelled appointment, no message; corrected or deleted customer data applies to queued reminders too), and it is not scattered across the job table.
- **Message text**: customer-care brandname SMS must match a template registered with the carriers, without diacritics (`references/notifications.md` section 5); unaccented text also fits 160 characters per SMS instead of 70. The time is formatted in the tenant's `time_zone` with a 4-digit year, never the server's zone.
- **Call the provider outside the transaction**, update the status afterwards. If the process dies between the two steps, the retry resends with the same `idempotencyKey`: if the provider supports that key, there is no duplicate; if not, accept a rare duplicate message, or add a `sending` status and have a person check jobs stuck in it.

## 4. Rules for every job

1. **Idempotent**: running twice gives the same result as running once. Every queue sometimes delivers a job twice (worker dies, `expireInSeconds` runs out).
2. **Small payload with `tenantId`**; read the latest data at run time. When the payload shape changes, the new worker must still read old payloads left in the queue.
3. **Bounded retries with backoff**; for errors that will not fix themselves (bad data, 4xx from an external API), do not retry pointlessly: mark as skipped and log, or send straight to dead letter.
4. **Have a dead letter queue and alert when it has jobs.** Jobs there need a person: fix the cause, then rerun (`boss.redrive(...)`).
5. **Timeouts on every external call**, shorter than the queue's `expireInSeconds`, so a job that is still running is not treated as stuck.
6. **Graceful shutdown on deploy**: on `SIGTERM`, stop taking new jobs and wait for running jobs to finish (`boss.stop({ graceful: true })`).
7. **Scheduled jobs do not overlap**: `singleton` queue or a lock; and they tolerate a missed run (wide time window + UNIQUE constraint, as in the example).
8. **Times in the business time zone**: schedules with `tz: 'Asia/Ho_Chi_Minh'`; dates in messages in the tenant's `time_zone` (`formatDateTime`), never server time.

## 5. Tests

Test with a real DB as the app role (as in `isolation-tests.md`), a real worker and a fake SMS provider. Run serially (`--test-concurrency=1`): the tests share the DB and queues. `pollingIntervalSeconds: 0.5` and short retries are for tests only, to keep them fast. Cases:

| Case | Expect |
|---|---|
| The worker role selects from `tenants` | 0 rows; `app_tenant_ids()` returns the active tenants |
| Appointments 1, 10 and 30 hours ahead, one cancelled, one in a suspended tenant | reminders only inside the 2–24 hour window, in active tenants; a rerun adds none |
| Enqueue in a transaction that then fails | no job |
| Worker run | exactly one message: unaccented ASCII, time in the tenant's zone, `idempotencyKey` = notification id; running the job again sends nothing |
| Customer renamed after enqueue | the message uses the new name and phone |
| Provider fails once / keeps failing | retried and sent / dead letter, notification stays `pending` |
| Job with another tenant's notification id, or the appointment cancelled | `skipped`, no message |
| Notification pointing at another tenant's appointment | rejected by the composite FK (`23503`) |
| Schedule | `*/10 * * * *` in `Asia/Ho_Chi_Minh` |

## 6. Operations

- Run the worker as a separate process (same image as the API, different start command) to scale and deploy it independently; the API only enqueues.
- Monitor (the `vibe-ship` skill, `references/observability.md`): waiting jobs per queue (`boss.getQueue(name)` has `queuedCount`, `activeCount`, `failedCount`), wait time of the oldest job, error rate, jobs in dead letter. Alert when a queue keeps growing or dead letter is non-zero.
- pg-boss deletes completed jobs after `deleteAfterSeconds` (default 7 days); watch the job table size at high volume.
- To disable a job type during an incident: `boss.offWork(name)` or a config flag, then re-enqueue later.
