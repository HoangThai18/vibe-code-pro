// test/session-state.test.ts — why a view filtered by a session variable is no substitute for RLS
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { checkSession, createAppPool } from '../src/db/pool';
import { APP_URL, endAll, errnoOf, owner, seedCustomer, seedTenant, type Tenant } from './helpers';

let a: Tenant, b: Tenant, aId: string, bId: string;
before(async () => {
  a = await seedTenant('Spa A');
  b = await seedTenant('Spa B');
  aId = (await seedCustomer(a, 'Khách của A', '0912345678')).id;
  bId = (await seedCustomer(b, 'Khách của B', '0987654321')).id;
  // A view cannot read a user variable; the usual workaround wraps it in a function
  assert.equal(await errnoOf(owner.query('CREATE VIEW my_customers AS SELECT id FROM customers WHERE tenant_id = @tenant_id')), 1351);
  await owner.query('CREATE FUNCTION app_tenant() RETURNS CHAR(36) CHARSET ascii DETERMINISTIC NO SQL RETURN @tenant_id');
  await owner.query('CREATE VIEW my_customers AS SELECT id, full_name FROM customers WHERE tenant_id = app_tenant()');
});
after(async () => {
  await owner.query('DROP VIEW IF EXISTS my_customers');
  await owner.query('DROP FUNCTION IF EXISTS app_tenant');
  await endAll();
});

test("the variable stays on the pooled connection: the next request sees the previous tenant's rows", async () => {
  const pool = createAppPool(APP_URL, { connectionLimit: 1 });
  try {
    const first = await pool.getConnection();          // request for tenant A
    await first.query('SET @tenant_id = ?', [a.tenantId]);
    first.release();
    const next = await pool.getConnection();           // request for tenant B, on a path that forgot the SET
    const [rows] = await next.query<any[]>('SELECT id FROM my_customers');
    next.release();
    assert.deepEqual(rows.map((r) => r.id), [aId]);
    // And the base table is still there for any query that skips the view
    const [all] = await pool.query<any[]>('SELECT id FROM customers WHERE id IN (?, ?)', [aId, bId]);
    assert.equal(all.length, 2);
  } finally {
    await pool.end();
  }
});

test('resetOnRelease clears the variable, and with it the time_zone set on connect', async () => {
  const pool = createAppPool(APP_URL, { connectionLimit: 1, resetOnRelease: true });
  try {
    const first = await pool.getConnection();
    await first.query('SET @tenant_id = ?', [a.tenantId]);
    first.release();
    const [rows] = await pool.query<any[]>('SELECT id FROM my_customers');
    assert.deepEqual(rows, []);                        // fail closed
    // COM_RESET_CONNECTION restores every session variable to its global value (here SYSTEM, the host's zone)
    const [[tz]] = await pool.query<any[]>('SELECT @@session.time_zone AS s, @@global.time_zone AS g');
    assert.equal(tz.s, tz.g);
    if (tz.g !== '+00:00') await assert.rejects(checkSession(pool), /session time_zone is/);
  } finally {
    await pool.end();
  }
});
