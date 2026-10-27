// test/text.test.ts — Vietnamese text: utf8mb4, collations, search, the customer use cases
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createCustomer, listCustomers, updateCustomer } from '../src/customers';
import { searchCustomers } from '../src/search';
import { withMember } from '../src/db/tenant';
import { ADMIN_URL, app, asOwner, connect, endAll, errnoOf, one, owner, seedCustomer, seedTenant, type Tenant } from './helpers';
import mysql from 'mysql2/promise';

let a: Tenant, b: Tenant;
before(async () => {
  a = await seedTenant('Spa A');
  b = await seedTenant('Spa B');
  for (const [name, phone] of [['Nguyễn Thị Thảo', '0912345678'], ['Đặng Thị Ánh', '0987000111'],
    ['Trần Văn Bình', '0903222333'], ['Bùi Thị Anh', '0903444555'], ['Lê Thị Phượng'.normalize('NFD'), '0903666777']]) {
    await seedCustomer(a, name!, phone!);
  }
  await seedCustomer(b, 'Nguyễn Thị Thảo', '0912999888');
});
after(endAll);

const names = async (q: string) => (await asOwner(a, (db, u) => searchCustomers(db, u, q))).map((c) => c.fullName);

test('every text column is utf8mb4 or ascii; utf8 still means utf8mb3, which rejects emoji', async () => {
  const [cols] = await owner.query<any[]>(
    `SELECT CONCAT(table_name, '.', column_name) AS col, character_set_name AS cs FROM information_schema.columns
      WHERE table_schema = DATABASE() AND character_set_name NOT IN ('utf8mb4', 'ascii')`);
  assert.deepEqual(cols, []);
  await owner.query('CREATE TEMPORARY TABLE legacy (note VARCHAR(50) CHARACTER SET utf8)');
  const [[ddl]] = await owner.query<any[]>('SHOW CREATE TABLE legacy');
  assert.match(ddl['Create Table'], /utf8mb3/);
  assert.equal(await errnoOf(owner.query("INSERT INTO legacy VALUES ('Cảm ơn 🙏')")), 1366);   // Incorrect string value
});

test('collations: 0900_ai_ci ignores every mark, vi_0900_ai_ci only tones', async () => {
  const eq = async (x: string, y: string, coll: string) =>
    Number((await one<any>(owner, `SELECT ? = ? COLLATE ${coll} AS eq`, [x, y])).eq);
  const pairs = [['Nguyễn', 'nguyen'], ['Đặng', 'dang'], ['Nguyễn', 'nguyên'], ['Hà', 'ha'], ['Ðông', 'dong']];
  const rows = [];
  for (const coll of ['utf8mb4_0900_ai_ci', 'utf8mb4_vi_0900_ai_ci', 'utf8mb4_unicode_ci', 'utf8mb4_general_ci']) {
    const r = [coll];
    for (const [x, y] of pairs) r.push(String(await eq(x!, y!, coll)));
    rows.push(r.join(' '));
  }
  assert.deepEqual(rows, [
    'utf8mb4_0900_ai_ci 1 1 1 1 1',
    'utf8mb4_vi_0900_ai_ci 0 0 1 1 0',   // ê, đ are letters of their own; tones are not
    'utf8mb4_unicode_ci 1 0 1 1 0',      // UCA 4.0: đ stays a letter of its own
    'utf8mb4_general_ci 1 0 1 1 0',
  ]);
});

test('Vietnamese order needs utf8mb4_vi_0900_ai_ci (or Intl.Collator in the app)', async () => {
  const order = async (coll: string) => (await one<any>(owner,
    `SELECT GROUP_CONCAT(n ORDER BY n COLLATE ${coll}, n COLLATE utf8mb4_bin SEPARATOR ' ') AS o
       FROM JSON_TABLE(?, '$[*]' COLUMNS (n VARCHAR(20) PATH '$')) j`,
    [JSON.stringify(['Đức', 'Dung', 'Ân', 'Ăn', 'An', 'Ơn', 'On', 'Ưng', 'Uyên', 'Zang'])])).o;
  assert.equal(await order('utf8mb4_0900_ai_ci'), 'An Ân Ăn Đức Dung On Ơn Ưng Uyên Zang');
  assert.equal(await order('utf8mb4_vi_0900_ai_ci'), 'An Ăn Ân Dung Đức On Ơn Uyên Ưng Zang');
  assert.equal(await order('utf8mb4_unicode_ci'), 'An Ân Ăn Dung Đức On Ơn Ưng Uyên Zang');
  assert.equal(await order('utf8mb4_general_ci'), 'An Ân Ăn Dung On Ơn Ưng Uyên Zang Đức');
});

test("mysql2's default connection collation (utf8mb4_unicode_ci) compares literals differently", async () => {
  const plain = await mysql.createConnection(ADMIN_URL);
  assert.deepEqual(await one(plain, "SELECT @@collation_connection AS c, 'Đặng' = 'dang' AS eq"), { c: 'utf8mb4_unicode_ci', eq: 0 });
  await plain.end();
  assert.deepEqual(await one(app, "SELECT @@collation_connection AS c, 'Đặng' = 'dang' AS eq"), { c: 'utf8mb4_0900_ai_ci', eq: 1 });
});

test('a UNIQUE key on an accent-insensitive column treats Hà and Ha as one value', async () => {
  await owner.query(`CREATE TEMPORARY TABLE services (name VARCHAR(50) NOT NULL UNIQUE,
    code VARCHAR(50) COLLATE utf8mb4_0900_as_cs NOT NULL UNIQUE)`);
  await owner.query("INSERT INTO services VALUES ('Gội đầu', 'Gội đầu')");
  assert.equal(await errnoOf(owner.query("INSERT INTO services VALUES ('Gói đầu', 'x')")), 1062);   // ai_ci: duplicate
  await owner.query("INSERT INTO services VALUES ('Massage', 'Gói đầu')");                           // as_cs: distinct
});

test('finds customers by any words, in any order, without accents, in Vietnamese order', async () => {
  assert.deepEqual(await names('thao'), ['Nguyễn Thị Thảo']);
  assert.deepEqual(await names('thao nguyen'), ['Nguyễn Thị Thảo']);
  assert.deepEqual(await names('ĐẶNG  ánh'), ['Đặng Thị Ánh']);
  assert.deepEqual(await names('dang anh'), ['Đặng Thị Ánh']);
  assert.deepEqual(await names('thi'), ['Bùi Thị Anh', 'Đặng Thị Ánh', 'Lê Thị Phượng', 'Nguyễn Thị Thảo']);
  assert.deepEqual(await names('ánh'), ['Đặng Thị Ánh', 'Bùi Thị Anh']);   // typed accents: exact first
  assert.deepEqual(await names('anh'), ['Bùi Thị Anh', 'Đặng Thị Ánh']);
});

test('a name sent decomposed (NFD) is stored NFC, so LIKE still finds it', async () => {
  assert.deepEqual(await names('phuong'), ['Lê Thị Phượng']);
  // The same name inserted without normalizing: = still matches, LIKE does not
  await owner.query("INSERT INTO customers (tenant_id, id, full_name, phone) VALUES (?, UUID(), ?, '0903888999')",
    [a.tenantId, 'Võ Thị Phượng'.normalize('NFD')]);
  assert.deepEqual(await names('phuong'), ['Lê Thị Phượng']);
  assert.equal((await one<any>(owner, 'SELECT COUNT(*) AS n FROM customers WHERE tenant_id = ? AND full_name = ?',
    [a.tenantId, 'Võ Thị Phượng'])).n, 1);
});

test('phones in any format; % and _ are text; never another tenant', async () => {
  for (const q of ['0912 345 678', '+84 912 345 678', '84912345678', '345678']) assert.deepEqual(await names(q), ['Nguyễn Thị Thảo'], q);
  assert.deepEqual(await names('%%'), []);
  assert.deepEqual(await names('__'), []);
  const hits = await asOwner(a, (db, u) => searchCustomers(db, u, 'nguyen thao'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.phone, '0912345678');   // A's Thảo, not B's
});

test('prefix LIKE is an index range; contains reads the whole tenant range', async () => {
  const plan = async (pattern: string) => (await one<any>(owner,
    "EXPLAIN SELECT id FROM customers WHERE tenant_id = ? AND full_name LIKE ? ORDER BY full_name LIMIT 20", [a.tenantId, pattern]));
  assert.deepEqual([(await plan('nguyen%')).type, (await plan('nguyen%')).key], ['range', 'customers_name']);
  assert.deepEqual([(await plan('%thao%')).type, (await plan('%thao%')).key], ['ref', 'customers_name']);
});

test('keyset: the row comparison (created_at, id) < (?, ?) is not an index range; the OR form is', async () => {
  const at = new Date();
  const plan = async (cond: string, params: unknown[]) => (await one<any>(owner,
    `EXPLAIN SELECT id FROM customers FORCE INDEX (customers_created) WHERE tenant_id = ? AND ${cond}
      ORDER BY created_at DESC, id DESC LIMIT 20`, [a.tenantId, ...params]));
  const row = await plan('(created_at, id) < (?, ?)', [at, 'x']);
  const or = await plan('(created_at < ? OR (created_at = ? AND id < ?))', [at, at, 'x']);
  assert.deepEqual([row.type, row.key_len, or.type], ['ref', '36', 'range']);
});

test('create normalizes the phone; a duplicate in the tenant is 409, in another tenant fine', async () => {
  const c = await asOwner(a, (db, u) => createCustomer(db, u, { fullName: '  Hồ   Ngọc Hà ', phone: '+84 905 111 222' }));
  assert.deepEqual([c.fullName, c.phone], ['Hồ Ngọc Hà', '0905111222']);
  await assert.rejects(asOwner(a, (db, u) => createCustomer(db, u, { fullName: 'Khác', phone: '0905 111 222' })),
    { status: 409, code: 'customer_phone_taken' });
  await seedCustomer(b, 'Hồ Ngọc Hà', '0905111222');
  // staff may read but not write customers
  await assert.rejects(withMember(app, a.tenantId, a.staffId, (db, u) => createCustomer(db, u, { fullName: 'X', phone: '0905000000' })),
    { status: 403 });
});

test('update: unchanged values are not a 404 (mysql2 sets CLIENT_FOUND_ROWS)', async () => {
  const c = await seedCustomer(a, 'Phan Thanh Tâm', '0906000111');
  const same = await asOwner(a, (db, u) => updateCustomer(db, u, c.id, { fullName: 'Phan Thanh Tâm' }));
  assert.equal(same.fullName, 'Phan Thanh Tâm');
  const changed = await asOwner(a, (db, u) => updateCustomer(db, u, c.id, { email: 'tam@example.vn' }));
  assert.deepEqual([changed.fullName, changed.email], ['Phan Thanh Tâm', 'tam@example.vn']);
});

test('keyset pagination: pages of 4 return every customer once, newest first', async () => {
  const t = await seedTenant('Spa phân trang');
  for (let i = 0; i < 10; i++) await seedCustomer(t, `Khách ${i}`, `090700000${i}`);   // many share a created_at ms
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page: Awaited<ReturnType<typeof listCustomers>> = await asOwner(t, (db, u) => listCustomers(db, u, { limit: 4, cursor }));
    seen.push(...page.data.map((c) => c.fullName));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.length, 10);
  assert.equal(new Set(seen).size, 10);
});
