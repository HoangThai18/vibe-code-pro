// test/jobs.test.ts — the reminder job on MySQL: tenant loop, idempotency, SKIP LOCKED workers
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { withTenant } from '../src/db/tenant';
import { CLAIM, claim } from '../src/jobs/claim';
import { enqueue, requeueExpired } from '../src/jobs/queue';
import { enqueueReminders, SEND_REMINDER, sendReminder, workOnce, type SmsSender } from '../src/jobs/reminders';
import { app, endAll, one, owner, seedTenant, type Tenant } from './helpers';

let a: Tenant, b: Tenant, off: Tenant;
const sent: { to: string; idempotencyKey: string }[] = [];
const sms: SmsSender = { send: async (m) => { sent.push(m); } };

async function appointment(t: Tenant, hoursAhead: number, status = 'booked') {
  const customerId = randomUUID();   // plain SQL: withMember refuses the suspended tenant
  await app.query('INSERT INTO customers (tenant_id, id, full_name, phone) VALUES (?, ?, ?, ?)',
    [t.tenantId, customerId, `Khách ${hoursAhead}h`, `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`]);
  const startsAt = new Date(Date.now() + hoursAhead * 3_600_000);
  await app.query(`INSERT INTO appointments (tenant_id, id, customer_id, staff_user_id, starts_at, ends_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [t.tenantId, randomUUID(), customerId, t.staffId, startsAt, new Date(startsAt.getTime() + 3_600_000), status]);
}
// Other test files leave appointments in other tenants: count only this file's tenants
const jobCount = async () => Number((await one<any>(owner,
  'SELECT COUNT(*) AS n FROM jobs WHERE queue = ? AND tenant_id IN (?)', [SEND_REMINDER, [a.tenantId, b.tenantId, off.tenantId]])).n);
const queued = async () => Number((await one<any>(owner, "SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued'")).n);

before(async () => {
  a = await seedTenant('Spa A');
  b = await seedTenant('Spa B');
  off = await seedTenant('Spa tạm ngưng', 'suspended');
  for (const h of [1, 10, 30]) await appointment(a, h);
  await appointment(a, 11, 'cancelled');
  await appointment(b, 12);
  await appointment(off, 10);
});
after(endAll);

test('enqueue: active tenants only, the 2-24 hour window, not cancelled; a rerun adds nothing', async () => {
  await enqueueReminders(app);
  const perTenant = async () => (await owner.query<any[]>(
    'SELECT tenant_id AS t, COUNT(*) AS n FROM notifications WHERE tenant_id IN (?) GROUP BY tenant_id',
    [[a.tenantId, b.tenantId, off.tenantId]]))[0].map((r) => [r.t === a.tenantId ? 'a' : r.t === b.tenantId ? 'b' : 'off', r.n]).sort();
  assert.deepEqual(await perTenant(), [['a', 1], ['b', 1]]);   // A's 10 h and B's 12 h
  assert.equal(await enqueueReminders(app), 0);
  assert.deepEqual(await perTenant(), [['a', 1], ['b', 1]]);
  assert.equal(await jobCount(), 2);
});

test('an enqueue in a transaction that fails leaves no job', async () => {
  await assert.rejects(withTenant(app, a.tenantId, async (db) => {
    await enqueue(db.conn, db.tenantId, SEND_REMINDER, { notificationId: randomUUID() });
    throw new Error('use case failed after the enqueue');
  }));
  assert.equal(await jobCount(), 2);
});

test('SKIP LOCKED: while one worker holds its batch, another claims different jobs at once', async () => {
  for (let h = 3; h <= 20; h++) await appointment(a, h);
  await enqueueReminders(app);
  const held = await app.getConnection();
  try {
    await held.beginTransaction();
    const [mine] = await held.query<any[]>(CLAIM, [SEND_REMINDER, 5]);   // a slow worker, mid-claim
    const t0 = Date.now();
    const other = await claim(app, SEND_REMINDER, 5);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(other.length, 5);
    assert.deepEqual(mine.filter((j: { id: number }) => other.some((o) => o.id === j.id)), []);
    // The same claim on the optimizer's own plan (a full scan of this small table) locks every queued row
    await held.rollback();
    await held.beginTransaction();
    await held.query(CLAIM.replace(' FORCE INDEX (jobs_ready)', ' IGNORE INDEX (jobs_ready)'), [SEND_REMINDER, 5]);
    assert.deepEqual(await claim(app, SEND_REMINDER, 5), []);
  } finally {
    await held.rollback();
    held.release();
    await owner.query("UPDATE jobs SET status = 'queued', locked_until = NULL WHERE status = 'running'");
  }
});

test('every reminder is sent exactly once; a job run again sends nothing', async () => {
  while ((await workOnce(app, sms)) > 0) { /* drain */ }
  assert.equal(await queued(), 0);
  const [ours] = await owner.query<any[]>('SELECT id, status FROM notifications WHERE tenant_id IN (?)', [[a.tenantId, b.tenantId]]);
  assert.equal(ours.length, 20);
  for (const n of ours) {
    assert.equal(n.status, 'sent');
    assert.equal(sent.filter((m) => m.idempotencyKey === n.id).length, 1);
  }
  const before = sent.length;
  assert.equal(await sendReminder(app, sms, a.tenantId, { notificationId: ours[0].id }), 'skipped');
  assert.equal(sent.length, before);
});

test("a job carrying another tenant's notification id sends nothing", async () => {
  await appointment(b, 15);
  await enqueueReminders(app);
  const { id } = await one<any>(owner, "SELECT id FROM notifications WHERE tenant_id = ? AND status = 'pending'", [b.tenantId]);
  assert.equal(await sendReminder(app, sms, a.tenantId, { notificationId: id }), 'skipped');
  assert.equal((await one<any>(owner, 'SELECT status FROM notifications WHERE id = ?', [id])).status, 'pending');
});

test('a failing provider: retried with backoff, then dead; an expired lease goes back to the queue', async () => {
  await owner.query("UPDATE jobs SET status = 'done' WHERE status = 'queued'");
  await appointment(a, 21);
  await enqueueReminders(app);
  const failing: SmsSender = { send: async () => { throw new Error('provider 503'); } };
  for (let i = 1; i <= 5; i++) {
    await owner.query("UPDATE jobs SET run_at = UTC_TIMESTAMP(3) WHERE status = 'queued'");   // skip the backoff wait
    assert.equal(await workOnce(app, failing), 1);
  }
  const job = await one<any>(owner, "SELECT status, attempts, last_error AS e FROM jobs ORDER BY id DESC LIMIT 1");
  assert.deepEqual(job, { status: 'dead', attempts: 5, e: 'Error: provider 503' });
  await owner.query("UPDATE jobs SET status = 'running', locked_until = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND ORDER BY id DESC LIMIT 1");
  assert.equal(await requeueExpired(app), 1);
});
