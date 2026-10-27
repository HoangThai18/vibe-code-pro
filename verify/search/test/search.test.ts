// test/search.test.ts: DATABASE_URL=postgres://<superuser>@localhost/search_check node --import tsx --test
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { searchCustomers } from '../src/search/customers';

const url = process.env.DATABASE_URL!;
const admin = new pg.Pool({ connectionString: url });
// The app connects as app_user (RLS applies); the superuser only sets up data
const app = new pg.Pool({ connectionString: url, options: '-c role=app_user' });
const tenantA = '00000000-0000-4000-8000-00000000000a';
const tenantB = '00000000-0000-4000-8000-00000000000b';

before(async () => {
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  for (const file of ['test/schema.sql', 'search.sql']) {
    execFileSync('psql', [url, '-q', '-v', 'ON_ERROR_STOP=1', '-f', file]);  // CONCURRENTLY needs autocommit
  }
  await admin.query("INSERT INTO tenants (id, name) VALUES ($1, 'Spa A'), ($2, 'Spa B')", [tenantA, tenantB]);
  await admin.query(
    `INSERT INTO customers (tenant_id, full_name, phone) VALUES
       ($1, 'Nguyễn Thị Thảo', '0912345678'), ($1, 'Đặng Thị Ánh', '0987000111'),
       ($1, 'Trần Văn Bình', '0903222333'), ($1, 'Bùi Thị Anh', '0903444555'),
       ($2, 'Nguyễn Thị Thảo', '0912999888')`,
    [tenantA, tenantB],
  );
});
after(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const names = async (q: string) => (await searchCustomers(app, tenantA, q)).map((c) => c.fullName);

test('search_key ignores accents, case and Unicode form', async () => {
  const { rows } = await admin.query(
    'SELECT search_key($1) AS a, search_key($2) AS b, search_key($3) AS c',
    ['Nguyễn Văn ĐỨC', 'Phượng'.normalize('NFD'), 'Ðông'],  // Ð (U+00D0) shows up in data converted from old encodings
  );
  assert.deepEqual(rows[0], { a: 'nguyen van duc', b: 'phuong', c: 'dong' });
});

test('finds customers by any words, in any order, without accents', async () => {
  assert.deepEqual(await names('thao'), ['Nguyễn Thị Thảo']);
  assert.deepEqual(await names('thao nguyen'), ['Nguyễn Thị Thảo']);
  assert.deepEqual(await names('ĐẶNG  ánh'), ['Đặng Thị Ánh']);
  assert.deepEqual(await names('dang anh'), ['Đặng Thị Ánh']);
  assert.deepEqual(await names('thi'), ['Bùi Thị Anh', 'Đặng Thị Ánh', 'Nguyễn Thị Thảo']);
});

test('typed with accents, exact matches come first; otherwise name order', async () => {
  assert.deepEqual(await names('ánh'), ['Đặng Thị Ánh', 'Bùi Thị Anh']);
  assert.deepEqual(await names('anh'), ['Bùi Thị Anh', 'Đặng Thị Ánh']);
});

test('finds customers by phone in any format', async () => {
  for (const q of ['0912 345 678', '+84 912 345 678', '84912345678', '345678']) {
    assert.deepEqual(await names(q), ['Nguyễn Thị Thảo'], q);
  }
});

test('treats % and _ as text, not wildcards', async () => {
  assert.deepEqual(await names('%%'), []);
  assert.deepEqual(await names('__'), []);
});

test("never returns another tenant's customers", async () => {
  const hits = await searchCustomers(app, tenantA, 'nguyen thao');
  const { rows } = await admin.query('SELECT id FROM customers WHERE tenant_id = $1', [tenantA]);
  assert.equal(hits.length, 1);
  assert.ok(rows.some((r) => r.id === hits[0]!.id));
});

test('fails closed without a tenant context', async () => {
  await assert.rejects(app.query("SELECT * FROM search_customers('thao')"), /no tenant context/);
});

test('the trigram index is usable only outside RLS', async () => {
  const plan = async (role: string) => {
    const db = await admin.connect();
    try {
      await db.query('BEGIN');
      await db.query(`SET LOCAL ROLE ${role}`);
      await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await db.query('SET LOCAL enable_seqscan = off');
      await db.query('SET LOCAL enable_indexscan = off');
      const { rows } = await db.query("EXPLAIN SELECT id FROM customers WHERE search_key(full_name) LIKE '%thao%'");
      return rows.map((r) => r['QUERY PLAN'] as string).join('\n');
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  };
  // app_user: LIKE is not leakproof, so RLS keeps it out of the index condition
  assert.doesNotMatch(await plan('app_user'), /Index Cond: .*~~/);
  // search_owner (BYPASSRLS, used by search_customers): LIKE goes into the trigram index
  assert.match(await plan('search_owner'), /Index Cond: .*~~/);
});

