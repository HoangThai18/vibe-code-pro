// test/time-money.test.ts — DATETIME in UTC, the session zone, time zone tables, "today", money types
process.env.TZ = 'Asia/Ho_Chi_Minh';   // like a server in Vietnam: Node's local zone is not UTC
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import mysql from 'mysql2/promise';
import { bookAppointment } from '../src/appointments';
import { checkSession } from '../src/db/pool';
import { appointmentsOnDay, dayRangeUtc } from '../src/time';
import { app, APP_URL, asOwner, endAll, errnoOf, one, owner, seedCustomer, seedTenant, type Tenant } from './helpers';

let a: Tenant;
before(async () => { a = await seedTenant('Spa A'); });
after(endAll);

test('createAppPool sessions are UTC; checkSession accepts them', async () => {
  assert.equal((await one<any>(app, 'SELECT @@time_zone AS tz')).tz, '+00:00');
  await checkSession(app);
});

test("mysql2's default timezone ('local') shifts every DATETIME by Node's offset", async () => {
  const at = new Date('2026-10-27T03:00:00.123Z');
  const local = mysql.createPool({ uri: APP_URL, connectionLimit: 1 });   // timezone defaults to 'local'
  const [[r]] = await local.query<any[]>('SELECT CAST(? AS DATETIME(3)) AS v', [at]);
  assert.equal((await one<any>(local, 'SELECT CAST(? AS CHAR) AS s', [at])).s, '2026-10-27 10:00:00.123');   // stored as +07
  assert.equal(r.v.getTime(), at.getTime());   // reads back "right" in the same process, wrong for everyone else
  await local.end();
  assert.equal((await one<any>(app, 'SELECT CAST(? AS CHAR) AS s', [at])).s, '2026-10-27 03:00:00.123');
});

test('CURRENT_TIMESTAMP follows the session zone; DEFAULT (UTC_TIMESTAMP(3)) does not; TIMESTAMP converts', async () => {
  const c = await owner.getConnection();
  try {
    await c.query(`CREATE TEMPORARY TABLE clock (id INT, a DATETIME(3) DEFAULT (UTC_TIMESTAMP(3)),
      b DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), t TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3))`);
    await c.query("SET time_zone = '+07:00'");   // a session (or server) left on Vietnam time
    await c.query('INSERT INTO clock (id) VALUES (1)');
    await c.query("SET time_zone = '+00:00'");
    const r = await one<any>(c, 'SELECT TIMESTAMPDIFF(MINUTE, a, b) AS ab, TIMESTAMPDIFF(MINUTE, a, t) AS at FROM clock');
    assert.deepEqual(r, { ab: 420, at: 0 });   // b is 7 hours "ahead": local time stored as if it were UTC
  } finally {
    await c.query("SET time_zone = '+00:00'");
    c.release();
  }
});

test('TIMESTAMP ends at 2038-01-19 03:14:07 UTC; DATETIME does not', async () => {
  await owner.query('CREATE TEMPORARY TABLE far (t TIMESTAMP NULL, d DATETIME NULL)');
  assert.equal(await errnoOf(owner.query("INSERT INTO far (t) VALUES ('2038-01-19 03:14:08')")), 1292);
  await owner.query("INSERT INTO far (d) VALUES ('2038-01-19 03:14:08')");
});

test('named zones need the time zone tables', async () => {
  const { n } = await one<any>(owner, 'SELECT COUNT(*) AS n FROM mysql.time_zone_name');
  const { v } = await one<any>(owner, "SELECT CONVERT_TZ('2026-10-27 17:30:00', '+00:00', 'Asia/Ho_Chi_Minh') AS v");
  if (Number(n) === 0) {
    assert.equal(v, null);   // no error: a "today" query built on it silently returns nothing
    assert.equal(await errnoOf(owner.query("SET time_zone = 'Asia/Ho_Chi_Minh'")), 1298);
  } else {
    assert.equal(v.toISOString(), '2026-10-28T00:30:00.000Z');
  }
  console.log(`# mysql.time_zone_name rows: ${n} (${await one<any>(owner, 'SELECT VERSION() AS v').then((r) => r.v)})`);
});

test("day ranges: Vietnam's day starts at 17:00 UTC; a DST day in New York has 25 hours", () => {
  assert.deepEqual(dayRangeUtc('2026-10-28', 'Asia/Ho_Chi_Minh').map((d) => d.toISOString()),
    ['2026-10-27T17:00:00.000Z', '2026-10-28T17:00:00.000Z']);
  const [from, to] = dayRangeUtc('2026-11-01', 'America/New_York');
  assert.deepEqual([from.toISOString(), (to.getTime() - from.getTime()) / 3_600_000], ['2026-11-01T04:00:00.000Z', 25]);
});

test("appointments on a day in the tenant's zone, through the (tenant_id, starts_at) index", async () => {
  const c = await seedCustomer(a, 'Nguyễn Văn An', '0912000111');
  const book = (iso: string) => asOwner(a, (db, u) => bookAppointment(db, u,
    { customerId: c.id, staffUserId: a.staffId, startsAt: new Date(iso), endsAt: new Date(Date.parse(iso) + 3_600_000) }));
  const early = await book('2026-10-27T16:30:00Z');   // 23:30 on the 27th in Vietnam
  const late = await book('2026-10-27T17:30:00Z');    // 00:30 on the 28th
  assert.deepEqual((await asOwner(a, (db) => appointmentsOnDay(db, '2026-10-28'))).map((r) => r.id), [late]);
  assert.deepEqual((await asOwner(a, (db) => appointmentsOnDay(db, '2026-10-27'))).map((r) => r.id), [early]);
  // key_len 43 = tenant_id (36) + starts_at (7): both columns of the index; a function on starts_at leaves 36
  const keyLen = async (where: string, params: unknown[]) => (await one<any>(owner,
    `EXPLAIN SELECT id FROM appointments FORCE INDEX (appointments_starts) WHERE tenant_id = ? AND ${where}`, [a.tenantId, ...params])).key_len;
  assert.equal(await keyLen('starts_at >= ? AND starts_at < ?', [new Date('2026-10-27T17:00:00Z'), new Date('2026-10-28T17:00:00Z')]), '43');
  assert.equal(await keyLen("DATE(CONVERT_TZ(starts_at, '+00:00', '+07:00')) = ?", ['2026-10-28']), '36');
});

test('money: BIGINT VND is exact; SUM() comes back as a string; FLOAT loses VND', async () => {
  await owner.query('CREATE TEMPORARY TABLE payments (amount BIGINT NOT NULL, approx FLOAT, price DECIMAL(15, 2))');
  await owner.query('INSERT INTO payments VALUES (123456789, 123456789, 19.99), (1500000, 1500000, 0.01)');
  const r = await one<any>(owner, `SELECT MAX(amount) AS maxAmount, SUM(amount) AS total, CAST(SUM(amount) AS SIGNED) AS totalInt,
    MAX(price) AS price, MAX(approx) = 123456789 AS floatExact, CAST(MAX(approx) AS SIGNED) AS floatValue FROM payments`);
  assert.deepEqual(r, { maxAmount: 123456789, total: '124956789', totalInt: 124956789, price: '19.99', floatExact: 0, floatValue: 123456792 });
});
