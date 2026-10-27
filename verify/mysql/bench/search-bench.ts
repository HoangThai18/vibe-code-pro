// npm run bench (by hand): 200,000 customers in one tenant, 20,000 in another; median of 15 warm runs.
// No RLS on MySQL, so the user running the queries does not change the plan.
// MYSQL_URL=mysql://root:root@127.0.0.1:3307 VERIFY_DB=bench_mysql npm run bench
import { randomUUID } from 'node:crypto';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { ADMIN_URL, DB } from '../scripts/env';

const BIG = 200_000, SMALL = 20_000, RUNS = 15;
const family: [string, number][] = [['Nguyễn', 38], ['Trần', 11], ['Lê', 9.5], ['Phạm', 7], ['Hoàng', 3], ['Huỳnh', 2],
  ['Phan', 4.5], ['Vũ', 2], ['Võ', 2], ['Đặng', 2.1], ['Bùi', 2], ['Đỗ', 1.4], ['Hồ', 1.3], ['Ngô', 1.3], ['Dương', 1], ['Lý', 0.5],
  ['Đinh', 1], ['Trương', 1], ['Mai', 0.8], ['Lâm', 0.6]];
const middle = ['Văn', 'Thị', 'Hữu', 'Đức', 'Minh', 'Ngọc', 'Thanh', 'Quốc', 'Hoàng', 'Thu', 'Kim', 'Xuân', 'Gia', 'Bảo', 'Thị Thu'];
const given = ['Anh', 'Ánh', 'An', 'Bình', 'Châu', 'Chi', 'Cường', 'Dũng', 'Duy', 'Đạt', 'Giang', 'Hà', 'Hải', 'Hạnh', 'Hằng', 'Hiếu',
  'Hoa', 'Hùng', 'Hương', 'Huy', 'Khánh', 'Lan', 'Linh', 'Long', 'Mai', 'Minh', 'My', 'Nam', 'Ngân', 'Ngọc', 'Nhung', 'Phong', 'Phúc',
  'Phương', 'Quân', 'Quang', 'Sơn', 'Tâm', 'Thảo', 'Thắng', 'Thành', 'Thu', 'Thủy', 'Tiến', 'Trang', 'Trinh', 'Trung', 'Tú', 'Tuấn',
  'Uyên', 'Vân', 'Việt', 'Vy', 'Yến'];
let seed = 42;   // mulberry32: the same data on every run
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
const total = family.reduce((s, [, w]) => s + w, 0);
const familyName = () => { let r = rnd() * total; for (const [n, w] of family) if ((r -= w) <= 0) return n; return 'Nguyễn'; };

const admin = await mysql.createConnection({ uri: ADMIN_URL, charset: 'utf8mb4_0900_ai_ci' });
await admin.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
await admin.query(`USE \`${DB}\``);
for (const t of ['customers_bench']) await admin.query(`DROP TABLE IF EXISTS ${t}`);
await admin.query(`CREATE TABLE customers_bench (
  tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  full_name VARCHAR(200) NOT NULL,
  phone     VARCHAR(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  visits    INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
  PRIMARY KEY (tenant_id, id), UNIQUE KEY (tenant_id, phone), KEY customers_name (tenant_id, full_name))`);
const A = randomUUID(), B = randomUUID();
const phones = new Set<string>();
for (const [tenant, n] of [[A, BIG], [B, SMALL]] as const) {
  for (let i = 0; i < n; i += 5000) {
    const rows = [];
    for (let j = 0; j < 5000 && i + j < n; j++) {
      let p; do p = `09${String(Math.floor(rnd() * 1e8)).padStart(8, '0')}`; while (phones.has(tenant + p));
      phones.add(tenant + p);
      rows.push([tenant, randomUUID(), `${familyName()} ${pick(middle)} ${pick(given)}`, p]);
    }
    await admin.query('INSERT INTO customers_bench (tenant_id, id, full_name, phone) VALUES ?', [rows]);
  }
}
await admin.query('ANALYZE TABLE customers_bench');

const timeIt = async (label: string, run: () => Promise<unknown>) => {
  await run();
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) { const t = performance.now(); await run(); ms.push(performance.now() - t); }
  ms.sort((a, b) => a - b);
  console.log(`${label.padEnd(70)} ${ms[Math.floor(RUNS / 2)]!.toFixed(1)} ms`);
};
// Migration timings on the 220,000 rows (before any FULLTEXT index: once a table has had one,
// ADD COLUMN ... ALGORITHM=INSTANT fails until the table is rebuilt)
for (const [label, sql] of [
  ['ADD COLUMN, ALGORITHM=INSTANT', 'ALTER TABLE customers_bench ADD COLUMN note VARCHAR(500) NULL, ALGORITHM=INSTANT'],
  ['ADD INDEX, ALGORITHM=INPLACE, LOCK=NONE', 'ALTER TABLE customers_bench ADD INDEX customers_created (tenant_id, created_at), ALGORITHM=INPLACE, LOCK=NONE'],
  ['ADD COLUMN + ADD INDEX in one ALTER (INPLACE: rebuilds)', 'ALTER TABLE customers_bench ADD COLUMN vip TINYINT NOT NULL DEFAULT 0, ADD INDEX customers_vip (tenant_id, vip), ALGORITHM=INPLACE, LOCK=NONE'],
  ['INT -> BIGINT, ALGORITHM=COPY (writes blocked)', 'ALTER TABLE customers_bench MODIFY visits BIGINT NOT NULL DEFAULT 0, ALGORITHM=COPY, LOCK=SHARED'],
] as const) {
  const t0 = performance.now();
  await admin.query(sql);
  console.log(`${label.padEnd(50)} ${((performance.now() - t0) / 1000).toFixed(2)} s`);
}

const q = (sql: string, params: unknown[]) => async () => { await admin.query<RowDataPacket[]>(sql, params); };
const like = (w: string) => `%${w}%`;
const [[share]] = await admin.query<RowDataPacket[]>(
  "SELECT ROUND(100 * SUM(full_name LIKE 'nguyen%') / COUNT(*)) AS s FROM customers_bench WHERE tenant_id = ?", [A]);
console.log(`MySQL ${(await admin.query<RowDataPacket[]>('SELECT VERSION() v'))[0][0]!.v}; Nguyễn: ${share!.s}% of names`);

const name = 'SELECT id, full_name FROM customers_bench WHERE tenant_id = ? AND ';
for (const [tenant, label] of [[A, '200k'], [B, '20k']] as const) {
  await timeIt(`[${label}] prefix LIKE 'tran thi th%'`, q(`${name} full_name LIKE ? ORDER BY full_name LIMIT 20`, [tenant, 'tran thi th%']));
  await timeIt(`[${label}] contains 'thao' (common)`, q(`${name} full_name LIKE ? ORDER BY full_name LIMIT 20`, [tenant, like('thao')]));
  await timeIt(`[${label}] contains 'dang' + 'anh'`, q(`${name} full_name LIKE ? AND full_name LIKE ? ORDER BY full_name LIMIT 20`, [tenant, like('dang'), like('anh')]));
  await timeIt(`[${label}] contains 'xyz' (no match: reads the whole tenant)`, q(`${name} full_name LIKE ? ORDER BY full_name LIMIT 20`, [tenant, like('xyz')]));
  await timeIt(`[${label}] phone prefix '0912%'`, q(`${name} phone LIKE ? ORDER BY phone LIMIT 20`, [tenant, '0912%']));
  await timeIt(`[${label}] phone contains '%345678%'`, q(`${name} phone LIKE ? ORDER BY phone LIMIT 20`, [tenant, like('345678')]));
  await timeIt(`[${label}] Vietnamese order: ORDER BY full_name COLLATE vi LIMIT 20`, q(`SELECT id, full_name FROM customers_bench WHERE tenant_id = ? ORDER BY full_name COLLATE utf8mb4_vi_0900_ai_ci LIMIT 20`, [tenant]));
}

// The search of src/customers.ts: words AND-ed, accent-typed exact matches first, Vietnamese order
const search = `SELECT id, full_name FROM customers_bench WHERE tenant_id = ? AND full_name LIKE ? AND full_name LIKE ?
  ORDER BY (full_name COLLATE utf8mb4_0900_as_ci LIKE ?) DESC, full_name COLLATE utf8mb4_vi_0900_ai_ci, id LIMIT 20`;
for (const [w1, w2, label] of [['nguyen', '', 'nguyen (41% of rows)'], ['thao', '', 'thao'], ['dang', 'anh', 'dang anh'], ['thảo', '', 'thảo (accents)'], ['xyz', '', 'xyz (no match)']]) {
  await timeIt(`[200k] search ${label}: rank + Vietnamese order`, q(search, [A, like(w1!), like(w2!), like(w1!)]));
  await timeIt(`[200k] search ${label}: index order (ORDER BY full_name)`, q(`${name} full_name LIKE ? AND full_name LIKE ? ORDER BY full_name LIMIT 20`, [A, like(w1!), like(w2!)]));
}

// FULLTEXT with the ngram parser: one index over every tenant
let t0 = performance.now();
await admin.query('ALTER TABLE customers_bench ADD FULLTEXT INDEX customers_ft (full_name) WITH PARSER ngram, ALGORITHM=INPLACE, LOCK=SHARED');
console.log(`ADD FULLTEXT ngram (220k rows, LOCK=SHARED): ${((performance.now() - t0) / 1000).toFixed(1)} s`);
const ft = 'SELECT id, full_name FROM customers_bench WHERE tenant_id = ? AND MATCH(full_name) AGAINST (? IN BOOLEAN MODE) LIMIT 20';
for (const [tenant, label] of [[A, '200k'], [B, '20k']] as const) {
  await timeIt(`[${label}] FULLTEXT '+"thao" +"nguyen"'`, q(ft, [tenant, '+"thao" +"nguyen"']));
  await timeIt(`[${label}] FULLTEXT '+"dang" +"anh"'`, q(ft, [tenant, '+"dang" +"anh"']));
  await timeIt(`[${label}] FULLTEXT '+"nguyen"' (41% of rows)`, q(ft, [tenant, '+"nguyen"']));
}
await admin.query('ALTER TABLE customers_bench DROP INDEX customers_ft');

// Vietnamese order from an index: a virtual column with the vi collation
t0 = performance.now();
await admin.query(`ALTER TABLE customers_bench ADD COLUMN name_vi VARCHAR(200) COLLATE utf8mb4_vi_0900_ai_ci
  GENERATED ALWAYS AS (full_name) VIRTUAL, ALGORITHM=INSTANT`);
await admin.query('ALTER TABLE customers_bench ADD INDEX customers_name_vi (tenant_id, name_vi), ALGORITHM=INPLACE, LOCK=NONE');
console.log(`ADD virtual name_vi + index (INPLACE, LOCK=NONE): ${((performance.now() - t0) / 1000).toFixed(1)} s`);
await timeIt('[200k] Vietnamese order from the name_vi index LIMIT 20', q('SELECT id, full_name FROM customers_bench WHERE tenant_id = ? ORDER BY name_vi LIMIT 20', [A]));

// Phone suffix: a stored reversed copy turns "ends with" into an index prefix
t0 = performance.now();
// In one ALTER, ADD COLUMN ... VIRTUAL + ADD INDEX on it refuses LOCK=NONE (1846): two statements
await admin.query(`ALTER TABLE customers_bench ADD COLUMN phone_rev VARCHAR(11) CHARACTER SET ascii COLLATE ascii_bin
  GENERATED ALWAYS AS (REVERSE(phone)) VIRTUAL, ALGORITHM=INSTANT`);
await admin.query('ALTER TABLE customers_bench ADD INDEX customers_phone_rev (tenant_id, phone_rev), ALGORITHM=INPLACE, LOCK=NONE');
console.log(`ADD virtual phone_rev + index: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
await timeIt('[200k] phone ends with 345678 via phone_rev', q(`${name} phone_rev LIKE ? LIMIT 20`, [A, `${[...'345678'].reverse().join('')}%`]));

await admin.query('DROP TABLE customers_bench');
await admin.end();
