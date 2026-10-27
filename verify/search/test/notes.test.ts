// test/notes.test.ts: DATABASE_URL=postgres://<superuser>@localhost/search_check_notes node --import tsx --test
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import pg from 'pg';

const url = process.env.DATABASE_URL!;
const admin = new pg.Pool({ connectionString: url });
const app = new pg.Pool({ connectionString: url, options: '-c role=app_user' });
const tenantA = '00000000-0000-4000-8000-00000000000a';

before(async () => {
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  for (const file of ['test/schema.sql', 'search.sql', 'notes-search.sql']) {
    execFileSync('psql', [url, '-q', '-v', 'ON_ERROR_STOP=1', '-f', file]);
  }
  await admin.query("INSERT INTO tenants (id, name) VALUES ($1, 'Spa A')", [tenantA]);
  await admin.query("INSERT INTO customers (tenant_id, full_name, phone) VALUES ($1, 'Nguyễn Thị Thảo', '0912345678')", [tenantA]);
  await admin.query(
    `INSERT INTO customer_notes (tenant_id, customer_id, body)
     SELECT tenant_id, id, unnest(ARRAY['Khách có da nhạy cảm, tránh peel.', 'Da khô vào mùa đông.', 'Cảm ơn khách đã giới thiệu bạn.'])
     FROM customers WHERE tenant_id = $1`,
    [tenantA],
  );
});
after(async () => {
  await Promise.all([admin.end(), app.end()]);
});

test('finds notes by words without accents; quotes match a phrase', async () => {
  const sql = readFileSync('notes-query.sql', 'utf8');
  const bodies = async (q: string) => {
    const db = await app.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      return (await db.query(sql, [q, tenantA])).rows.map((r) => r.body as string);
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  };
  assert.deepEqual(await bodies('da nhay cam'), ['Khách có da nhạy cảm, tránh peel.']);
  // "da" also matches "đã" (accents removed); the notes that contain "da" itself come first
  const da = await bodies('da');
  assert.equal(da.length, 3);
  assert.equal(da[2], 'Cảm ơn khách đã giới thiệu bạn.');
  assert.equal((await bodies('đã'))[0], 'Cảm ơn khách đã giới thiệu bạn.');
  assert.deepEqual(await bodies('"cam on"'), ['Cảm ơn khách đã giới thiệu bạn.']);
  assert.deepEqual(await bodies('"on cam"'), []);
});
