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
{{sql/notifications.sql}}
```

```ts
{{src/jobs/queues.ts}}
```

```ts
{{src/jobs/reminders.ts}}
```

```ts
{{src/jobs/worker.ts}}
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
