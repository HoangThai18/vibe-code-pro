// Real PostgreSQL 16, app role without BYPASSRLS: DATABASE_URL=postgres://vibe_test:vibe@localhost:5432/i18n_check
import '../src/db/pg-types';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { appointmentsOnDay } from '../src/appointments/by-day';
import { withTenant } from '../src/db/tenant';
import { localDate } from '../src/i18n/format';
import { cleanText, compareVi } from '../src/i18n/text';

const url = process.env.DATABASE_URL ?? 'postgres://vibe_test:vibe@localhost:5432/i18n_check';
const admin = new pg.Pool({ connectionString: url });
const pool = new pg.Pool({ connectionString: url, options: '-c role=app_user' }); // RLS applies
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // Asia/Ho_Chi_Minh
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // Europe/Berlin branch: DST ends on 2026-10-25
let customerA = '';

before(async () => {
  for (const f of ['base', 'schema', 'appointments', 'rls']) await admin.query(readFileSync(`sql/${f}.sql`, 'utf8'));
  await admin.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Spa Hoa Mai')`, [A]);
  await admin.query(`INSERT INTO tenants (id, name, default_locale, time_zone) VALUES ($1, 'Spa Berlin', 'en', 'Europe/Berlin')`, [B]);
  const ins = async (tenant: string, times: string[]) =>
    withTenant(pool, tenant, async (db) => {
      const { rows: [c] } = await db.query<{ id: string }>(
        `INSERT INTO customers (full_name, birthday) VALUES ('Lan', '2001-07-18') RETURNING id`);
      for (const t of times) await db.query('INSERT INTO appointments (customer_id, starts_at) VALUES ($1, $2)', [c!.id, t]);
      return c!.id;
    });
  customerA = await ins(A, ['2026-10-23T16:59:59Z', '2026-10-23T17:00:00Z', '2026-10-24T16:59:59Z', '2026-10-24T17:00:00Z']);
  await ins(B, ['2026-10-24T21:59:59Z', '2026-10-24T22:00:00Z', '2026-10-25T22:59:59Z', '2026-10-25T23:00:00Z', new Date().toISOString()]);
});
after(async () => {
  await pool.end();
  await admin.end();
});

const isoTimes = (rows: { starts_at: Date }[]) => rows.map((r) => r.starts_at.toISOString());

test('a Vietnamese day runs from 17:00 UTC to 17:00 UTC', async () => {
  const rows = await withTenant(pool, A, (db) => appointmentsOnDay(db, '2026-10-24'));
  assert.deepEqual(isoTimes(rows), ['2026-10-23T17:00:00.000Z', '2026-10-24T16:59:59.000Z']);
});

test('naive starts_at::date uses the session zone (UTC here) and picks the wrong rows', async () => {
  const { rows } = await withTenant(pool, A, (db) =>
    db.query<{ starts_at: Date }>(`SELECT starts_at FROM appointments WHERE starts_at::date = '2026-10-24' ORDER BY 1`));
  assert.deepEqual(isoTimes(rows), ['2026-10-24T16:59:59.000Z', '2026-10-24T17:00:00.000Z']);
});

test('a branch abroad: the DST-end day has 25 hours', async () => {
  const rows = await withTenant(pool, B, (db) => appointmentsOnDay(db, '2026-10-25'));
  assert.deepEqual(isoTimes(rows), ['2026-10-24T22:00:00.000Z', '2026-10-25T22:59:59.000Z']);
});

test('"today" defaults to the tenant zone; another tenant sees nothing (RLS)', async () => {
  const today = await withTenant(pool, B, (db) => appointmentsOnDay(db, null));
  assert.ok(today.every((r) => localDate(r.starts_at, 'Europe/Berlin') === localDate(new Date(), 'Europe/Berlin')));
  assert.ok(today.length >= 1);
  const { rows } = await withTenant(pool, A, (db) => db.query('SELECT id FROM appointments WHERE customer_id = $1', [customerA]));
  assert.equal(rows.length, 4);
  const none = await pool.query('SELECT count(*) AS n FROM appointments'); // no tenant context: fail closed
  assert.equal(none.rows[0].n, 0);
});

test('time zone: only known IANA names are stored', async () => {
  const insert = (tz: string) => admin.query(`INSERT INTO tenants (name, time_zone) VALUES ('x', $1)`, [tz]);
  // Node 22 and Chromium report Vietnam as 'Asia/Saigon'; this Postgres build (Ubuntu system tzdata) does not know it
  assert.equal(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Ho_Chi_Minh' }).resolvedOptions().timeZone, 'Asia/Saigon');
  await assert.rejects(insert('Asia/Saigon'), /time zone "Asia\/Saigon" not recognized/);
  // POSIX-style strings: Postgres reads 'GMT+7' and '+07' as UTC-7 (Intl reads '+07:00' as UTC+7)
  const { rows: [r] } = await admin.query(`SELECT to_char(TIMESTAMPTZ '2026-10-24 08:30Z' AT TIME ZONE 'GMT+7', 'HH24:MI') AS gmt7,
                                                  to_char(TIMESTAMPTZ '2026-10-24 08:30Z' AT TIME ZONE '+07', 'HH24:MI') AS plus07`);
  assert.deepEqual(r, { gmt7: '01:30', plus07: '01:30' });
  for (const tz of ['GMT+7', '+07', 'ICT', 'Hà Nội']) await assert.rejects(insert(tz), /tenants_time_zone_check/, tz);
  await insert('Asia/Bangkok');
});

test('names: NFD is refused by the CHECK, cleanText fixes it; vi-x-icu sorts like Intl.Collator("vi")', async () => {
  const nfd = 'Nguyễn Văn A'.normalize('NFD');
  await assert.rejects(withTenant(pool, A, (db) => db.query(`INSERT INTO customers (full_name) VALUES ($1)`, [nfd])),
    /customers_full_name_check/);
  const names = ['Đặng', 'Dương', 'Ánh', 'Bình', 'Anh', 'Âu', 'Ăn', 'Zô'];
  await withTenant(pool, A, async (db) => {
    await db.query(`INSERT INTO customers (full_name) VALUES ($1)`, [cleanText(nfd)]);
    for (const n of names) await db.query(`INSERT INTO customers (full_name) VALUES ($1)`, [n]);
  });
  const sorted = async (collate: string) =>
    (await withTenant(pool, A, (db) => db.query<{ full_name: string }>(
      `SELECT full_name FROM customers WHERE full_name = ANY($1) ORDER BY full_name ${collate}`, [names]))).rows.map((r) => r.full_name);
  assert.deepEqual(await sorted('COLLATE "vi-x-icu"'), [...names].sort(compareVi));
  assert.deepEqual(await sorted(''), ['Anh', 'Bình', 'Dương', 'Zô', 'Ánh', 'Âu', 'Ăn', 'Đặng']); // C.UTF-8 database default
});

test('pg parsers: date stays YYYY-MM-DD, bigint money becomes a number', async () => {
  const { rows: [r] } = await withTenant(pool, A, (db) =>
    db.query(`SELECT birthday, 1250000::bigint AS price FROM customers WHERE id = $1`, [customerA]));
  assert.equal(r.birthday, '2001-07-18');
  assert.equal(r.price, 1_250_000);
  await assert.rejects(admin.query('SELECT 9007199254740993::bigint AS n'), RangeError);
});
