// test/booking.test.ts — no double booking without exclusion constraints, under real concurrency
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { PoolConnection } from 'mysql2/promise';
import { bookAppointment } from '../src/appointments';
import { retryOnDeadlock, withMember, withTenant, withTransaction } from '../src/db/tenant';
import { app, asOwner, endAll, errnoOf, one, owner, seedCustomer, seedStaff, seedTenant, sleep, type Tenant } from './helpers';

let a: Tenant, customer: { id: string };
before(async () => {
  a = await seedTenant('Spa A');
  customer = await seedCustomer(a, 'Nguyễn Văn An', '0912000111');
  await owner.query(readFileSync('sql/appointment-slots.sql', 'utf8'));
});
after(async () => {
  await owner.query('DROP TABLE IF EXISTS appointment_slots');
  await endAll();
});

let day = 0;
const nextSlot = () => {   // each test books on its own day
  const startsAt = new Date(Date.UTC(2026, 11, 1 + day++, 3));
  return { startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) };
};
const count = async (staff: string, s: { startsAt: Date }) => Number((await one<any>(owner,
  'SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND staff_user_id = ? AND starts_at = ?', [a.tenantId, staff, s.startsAt])).n);

test('10 concurrent bookings of one slot: 1 booked, 9 × 409 appointment_slot_taken, no deadlock to retry', async () => {
  const slot = nextSlot();
  const actor = { type: 'user', id: a.managerId, role: 'manager' } as const;
  // withTransaction, not withMember: without the staff lock, gap-lock deadlocks and retries would hide here
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => withTransaction(app, (conn) =>
    bookAppointment({ conn, tenantId: a.tenantId }, actor, { customerId: customer.id, staffUserId: a.staffId, ...slot }))));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const codes = results.flatMap((r) => (r.status === 'rejected' ? [(r.reason as { code: string }).code] : []));
  assert.deepEqual(codes, Array(9).fill('appointment_slot_taken'));   // no deadlocks, no 500s
  assert.equal(await count(a.staffId, slot), 1);
});

test('the same through withMember, whose membership check reads first: still 1 booked, 9 × 409', async () => {
  const slot = nextSlot();
  const results = await Promise.allSettled(Array.from({ length: 10 }, () =>
    withMember(app, a.tenantId, a.managerId, (db, u) => bookAppointment(db, u, { customerId: customer.id, staffUserId: a.staffId, ...slot }))));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);   // a plain overlap SELECT would book twice here
  assert.equal(await count(a.staffId, slot), 1);
});

test('10 staff of one tenant booking the same hour at once: all booked, no deadlock to retry', async () => {
  const t = await seedTenant('Spa đông thợ');
  const c = await seedCustomer(t, 'Trần Thị Mai', '0912000222');
  const staff = await Promise.all(Array.from({ length: 10 }, () => seedStaff(t)));
  for (const s of staff) {   // a little history, as in a real tenant
    for (const d of [1, 2]) {
      await owner.query('INSERT INTO appointments (tenant_id, id, customer_id, staff_user_id, starts_at, ends_at) VALUES (?, UUID(), ?, ?, ?, ?)',
        [t.tenantId, c.id, s, new Date(Date.UTC(2026, 10, d, 3)), new Date(Date.UTC(2026, 10, d, 4))]);
    }
  }
  const actor = { type: 'user', id: t.ownerId, role: 'owner' } as const;
  for (let round = 0; round < 5; round++) {
    const slot = nextSlot();
    // withTransaction, not withMember: no retry here, so a deadlock fails the test
    const results = await Promise.allSettled(staff.map((s) => withTransaction(app, (conn) =>
      bookAppointment({ conn, tenantId: t.tenantId }, actor, { customerId: c.id, staffUserId: s, ...slot }))));
    assert.deepEqual(results.map((r) => (r.status === 'fulfilled' ? 'ok' : (r.reason as Error).message)), Array(10).fill('ok'));
  }
});

test('overlaps are taken, touching slots and other staff are free, cancelled ones do not count', async () => {
  const s = nextSlot();
  const book = (staff: string, from: number, to: number) => asOwner(a, (db, u) => bookAppointment(db, u,
    { customerId: customer.id, staffUserId: staff, startsAt: new Date(s.startsAt.getTime() + from * 60_000), endsAt: new Date(s.startsAt.getTime() + to * 60_000) }));
  const first = await book(a.staffId, 0, 60);
  await assert.rejects(book(a.staffId, 30, 90), { code: 'appointment_slot_taken' });
  await book(a.staffId, 60, 120);   // 10:00-11:00 then 11:00-12:00
  await book(a.staff2Id, 0, 60);
  await owner.query("UPDATE appointments SET status = 'cancelled' WHERE tenant_id = ? AND id = ?", [a.tenantId, first]);
  await book(a.staffId, 0, 60);
});

test('staff book only for themselves; managers for anyone', async () => {
  const s = nextSlot();
  await assert.rejects(withMember(app, a.tenantId, a.staffId, (db, u) =>
    bookAppointment(db, u, { customerId: customer.id, staffUserId: a.staff2Id, ...s })), { status: 403 });
  await withMember(app, a.tenantId, a.staffId, (db, u) => bookAppointment(db, u, { customerId: customer.id, staffUserId: a.staffId, ...s }));
  await withMember(app, a.tenantId, a.managerId, (db, u) => bookAppointment(db, u, { customerId: customer.id, staffUserId: a.staff2Id, ...s }));
});

// The guards that do not hold, shown step by step on two connections
const overlap = `SELECT id FROM appointments WHERE tenant_id = ? AND staff_user_id = ? AND status <> 'cancelled'
  AND starts_at > ? - INTERVAL 12 HOUR AND starts_at < ? AND ends_at > ?`;
const insert = (c: PoolConnection, s: { startsAt: Date; endsAt: Date }) => c.query(
  'INSERT INTO appointments (tenant_id, id, customer_id, staff_user_id, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)',
  [a.tenantId, randomUUID(), customer.id, a.staffId, s.startsAt, s.endsAt]);
async function twoConnections<T>(fn: (c1: PoolConnection, c2: PoolConnection) => Promise<T>): Promise<T> {
  const [c1, c2] = [await app.getConnection(), await app.getConnection()];
  try {
    return await fn(c1, c2);
  } finally {
    await Promise.all([c1.rollback(), c2.rollback()]);
    c1.release();
    c2.release();
  }
}

test('check-then-insert with a plain SELECT double books', async () => {
  const s = nextSlot();
  const args = [a.tenantId, a.staffId, s.startsAt, s.endsAt, s.startsAt];
  await twoConnections(async (c1, c2) => {
    await c1.beginTransaction(); await c2.beginTransaction();
    assert.equal((await c1.query<any[]>(overlap, args))[0].length, 0);
    assert.equal((await c2.query<any[]>(overlap, args))[0].length, 0);
    await insert(c1, s); await c1.commit();
    await insert(c2, s); await c2.commit();
  });
  assert.equal(await count(a.staffId, s), 2);
});

test('FOR UPDATE on the overlap check alone: gap locks deadlock (1213); a retry then sees the booking', async () => {
  // The last tenant in key order, so the window is followed by the end of the index (the supremum):
  // both transactions then get the same gap lock. Followed by another row, the second check waits instead.
  const z = await seedTenant('Spa Z', 'active', 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  const zc = await seedCustomer(z, 'Ngô Văn Z', '0912000333');
  const s = nextSlot();
  const args = [z.tenantId, z.staffId, s.startsAt, s.endsAt, s.startsAt];
  const book = (c: PoolConnection) => c.query(
    'INSERT INTO appointments (tenant_id, id, customer_id, staff_user_id, starts_at, ends_at) VALUES (?, UUID(), ?, ?, ?, ?)',
    [z.tenantId, zc.id, z.staffId, s.startsAt, s.endsAt]).then(() => c.commit()).then(() => 0, (e) => e.errno);
  const errnos = await twoConnections(async (c1, c2) => {
    await c1.beginTransaction(); await c2.beginTransaction();
    await c1.query(`${overlap.replace('FROM appointments', 'FROM appointments FORCE INDEX (appointments_staff)')} FOR UPDATE`, args);
    await c2.query(`${overlap.replace('FROM appointments', 'FROM appointments FORCE INDEX (appointments_staff)')} FOR UPDATE`, args);
    const p1 = book(c1);   // waits for c2's gap lock
    await sleep(100);
    const p2 = book(c2);   // closes the cycle
    return [await p1, await p2].sort().join(',');
  });
  assert.equal(errnos, '0,1213');
  // retryOnDeadlock runs the losing transaction again from the start; this time it finds the booking
  let attempts = 0;
  await assert.rejects(retryOnDeadlock(async () => {
    if (++attempts === 1) throw Object.assign(new Error('Deadlock found'), { errno: 1213 });
    return withMember(app, z.tenantId, z.ownerId, (db, u) => bookAppointment(db, u, { customerId: zc.id, staffUserId: z.staffId, ...s }));
  }), { code: 'appointment_slot_taken' });
  assert.equal(attempts, 2);
});

test('the staff lock with a plain overlap check still double books under REPEATABLE READ', async () => {
  const lockStaff = 'SELECT user_id FROM memberships WHERE tenant_id = ? AND user_id = ? FOR UPDATE';
  const booked: Record<string, number> = {};
  for (const level of ['REPEATABLE READ', 'READ COMMITTED']) {
    const s = nextSlot();
    await twoConnections(async (c1, c2) => {
      await c1.query(`SET TRANSACTION ISOLATION LEVEL ${level}`);
      await c1.beginTransaction(); await c2.beginTransaction();
      await c1.query('SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ?', [a.tenantId, a.ownerId]);   // withMember's check
      await c2.query(lockStaff, [a.tenantId, a.staffId]);
      await insert(c2, s);
      const waiting = c1.query(lockStaff, [a.tenantId, a.staffId]);   // waits for c2
      await sleep(100);
      await c2.commit();
      await waiting;
      const [seen] = await c1.query<any[]>(overlap, [a.tenantId, a.staffId, s.startsAt, s.endsAt, s.startsAt]);
      if (seen.length === 0) { await insert(c1, s); await c1.commit(); }
    });
    booked[level] = await count(a.staffId, s);
  }
  // REPEATABLE READ: the plain SELECT read the snapshot taken before the lock wait and booked again.
  // READ COMMITTED saw the committed row. bookAppointment's FOR SHARE holds at either level.
  assert.deepEqual(booked, { 'REPEATABLE READ': 2, 'READ COMMITTED': 1 });
});

test('fixed slots: a slot table with a primary key holds under 10 concurrent bookings', async () => {
  const s = nextSlot();
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => withTenant(app, a.tenantId, async (db) => {
    const id = randomUUID();
    await db.conn.query('INSERT INTO appointments (tenant_id, id, customer_id, staff_user_id, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)',
      [db.tenantId, id, customer.id, a.staff2Id, s.startsAt, s.endsAt]);
    await db.conn.query('INSERT INTO appointment_slots (tenant_id, staff_user_id, slot_start, appointment_id) VALUES ?',
      [[0, 30].map((m) => [db.tenantId, a.staff2Id, new Date(s.startsAt.getTime() + m * 60_000), id])]);
  })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.deepEqual([...new Set(results.flatMap((r) => (r.status === 'rejected' ? [(r.reason as { errno: number }).errno] : [])))], [1062]);
  assert.equal(await count(a.staff2Id, s), 1);
});

test('an FK failure is 1452 for the owner; for the app user (database-level grants) 8.0 says 1216', async () => {
  const s = nextSlot();
  const bogus = [a.tenantId, randomUUID(), randomUUID(), a.staffId, s.startsAt, s.endsAt];
  const sql = 'INSERT INTO appointments (tenant_id, id, customer_id, staff_user_id, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)';
  const { v } = await one<any>(app, 'SELECT VERSION() AS v');
  assert.equal(await errnoOf(app.query(sql, bogus)), String(v).startsWith('8.0.') ? 1216 : 1452);   // 8.4.13: 1452
  assert.equal(await errnoOf(owner.query(sql, bogus)), 1452);
});
