// test/isolation.test.ts — as the app's DML-only user: on MySQL these tests are the only proof of isolation
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { bookAppointment } from '../src/appointments';
import { createCustomer, getCustomer, listCustomers, updateCustomer } from '../src/customers';
import { withMember } from '../src/db/tenant';
import { app, endAll, errnoOf, owner, seedCustomer, seedTenant, type Tenant } from './helpers';

let a: Tenant, b: Tenant, aCustomer: { id: string }, bCustomer: { id: string };
before(async () => {
  a = await seedTenant('Spa A');
  b = await seedTenant('Spa B');
  aCustomer = await seedCustomer(a, 'Khách của A', '0912345678');
  bCustomer = await seedCustomer(b, 'Khách của B', '0912345678');   // same phone, other tenant: allowed
});
after(endAll);

const status = (p: Promise<unknown>) => p.then(() => 200, (e: { status?: number }) => e.status ?? 500);

test("A cannot read or update B's customer, by either path", async () => {
  // 1. B's id in A's path: only the tenant_id filter in the query stops it
  assert.equal(await status(withMember(app, a.tenantId, a.ownerId, (db, u) => getCustomer(db, u, bCustomer.id))), 404);
  assert.equal(await status(withMember(app, a.tenantId, a.ownerId, (db, u) => updateCustomer(db, u, bCustomer.id, { fullName: 'hack' }))), 404);
  // 2. B's path, A's user: the membership check stops it
  assert.equal(await status(withMember(app, b.tenantId, a.ownerId, (db, u) => getCustomer(db, u, bCustomer.id))), 404);
  assert.equal(await status(withMember(app, 'not-a-uuid', a.ownerId, async () => 1)), 404);
  // B's data unchanged, and B itself succeeds (control: a broken route also returns 404)
  const own = await withMember(app, b.tenantId, b.ownerId, (db, u) => getCustomer(db, u, bCustomer.id));
  assert.equal(own.fullName, 'Khách của B');
});

test("A's list has A's rows and none of B's", async () => {
  const { data } = await withMember(app, a.tenantId, a.ownerId, (db, u) => listCustomers(db, u, { limit: 100 }));
  const ids = data.map((c) => c.id);
  assert.ok(ids.includes(aCustomer.id));   // control: an empty list would pass the next line
  assert.ok(!ids.includes(bCustomer.id));
});

test("A cannot book with B's customer: the composite FK rejects it", async () => {
  const slot = { staffUserId: a.staffId, startsAt: new Date('2026-11-02T03:00:00Z'), endsAt: new Date('2026-11-02T04:00:00Z') };
  const cross = withMember(app, a.tenantId, a.ownerId, (db, u) => bookAppointment(db, u, { customerId: bCustomer.id, ...slot }));
  await assert.rejects(cross, { status: 422, code: 'invalid_reference' });
  const own = await withMember(app, a.tenantId, a.ownerId, (db, u) => bookAppointment(db, u, { customerId: aCustomer.id, ...slot }));
  assert.ok(own);
});

test('a tenantId sent by the client is ignored', async () => {
  const body = { fullName: 'Tạo lậu', phone: '0911111111', tenantId: b.tenantId };
  const c = await withMember(app, a.tenantId, a.ownerId, (db, u) => createCustomer(db, u, body));
  assert.equal(await status(withMember(app, a.tenantId, a.ownerId, (db, u) => getCustomer(db, u, c.id))), 200);
  assert.equal(await status(withMember(app, b.tenantId, b.ownerId, (db, u) => getCustomer(db, u, c.id))), 404);
});

test('a suspended tenant is a 404 even for its owner', async () => {
  const s = await seedTenant('Spa tạm ngưng', 'suspended');
  assert.equal(await status(withMember(app, s.tenantId, s.ownerId, async () => 1)), 404);
});

test('every query on a tenant table in src/ filters tenant_id', () => {
  const tenantTables = /\b(customers|appointments|memberships|notifications)\b/;
  const offenders: string[] = [];
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(`${dir}/${e.name}`) : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : []));
  let checked = 0;
  for (const file of files('src')) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/`([^`]*)`|'([^'\n]*)'|"([^"\n]*)"/g)) {
      const s = m[1] ?? m[2] ?? m[3] ?? '';
      if (!/^\s*(SELECT|INSERT|UPDATE|DELETE)\b/.test(s) || !tenantTables.test(s)) continue;
      checked++;
      if (!/tenant_id/.test(s)) offenders.push(`${file}: ${s.trim().slice(0, 60)}`);
    }
  }
  assert.ok(checked >= 10, `only ${checked} statements found: the scan is broken`);
  assert.deepEqual(offenders, []);
});

test('the app user cannot change the schema, and a table-level REVOKE cannot narrow a database grant', async () => {
  assert.equal(await errnoOf(app.query('ALTER TABLE customers ADD COLUMN x INT')), 1142);   // ER_TABLEACCESS_DENIED_ERROR
  const [[{ user }]] = await app.query<any[]>('SELECT CURRENT_USER() AS user');
  const [name] = String(user).split('@');
  // GRANT ... ON db.* cannot be narrowed per table: grant table by table for append-only tables (audit_log)
  assert.equal(await errnoOf(owner.query(`REVOKE UPDATE, DELETE ON customers FROM '${name}'@'%'`)), 1147);   // ER_NONEXISTING_TABLE_GRANT
});
