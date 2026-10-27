// privacy.md section 3: consents are append-only evidence; purposes are read-only; the view keeps RLS
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { setupDatabase } from './setup-db';

const url = process.env.DATABASE_URL!;
setupDatabase(url);
const admin = new pg.Pool({ connectionString: url });
const app = new pg.Pool({ connectionString: url, options: '-c role=app_user' });
const A = randomUUID();
const B = randomUUID();
const customer = randomUUID();

async function inTenant<T>(tenantId: string, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await app.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }
}
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code);

before(async () => {
  await admin.query("INSERT INTO tenants (id, name) VALUES ($1, 'Spa A'), ($2, 'Spa B')", [A, B]);
  await admin.query("INSERT INTO consent_purposes (id, version, text_vi) VALUES ('marketing_sms', 1, 'Tôi đồng ý nhận tin khuyến mãi qua SMS')");
});
after(() => Promise.all([admin.end(), app.end()]));

test('consent then withdrawal: the view shows the latest, granted = false', async () => {
  await inTenant(A, (db) => db.query(
    `INSERT INTO consents (subject_id, purpose_id, purpose_version, granted, method)
     VALUES ($1, 'marketing_sms', 1, true, 'web_form'), ($1, 'marketing_sms', 1, false, 'sms')`, [customer]));
  const { rows } = await inTenant(A, (db) => db.query('SELECT granted FROM current_consents WHERE subject_id = $1', [customer]));
  assert.deepEqual(rows, [{ granted: false }]);
});

test('the app role cannot change or delete consents, nor write purposes', async () => {
  for (const sql of ['UPDATE consents SET granted = true', 'DELETE FROM consents', 'TRUNCATE consents']) {
    assert.equal(await code(inTenant(A, (db) => db.query(sql))), '42501', sql);
  }
  for (const sql of ["INSERT INTO consent_purposes VALUES ('ai_summary', 1, 'x')", "UPDATE consent_purposes SET text_vi = 'khác'",
    'DELETE FROM consent_purposes']) {
    assert.equal(await code(app.query(sql)), '42501', sql);
  }
  assert.equal((await app.query('SELECT 1 FROM consent_purposes')).rowCount, 1);
});

test('tenant B sees none of A\'s consents through the view; a view without security_invoker leaks them', async () => {
  assert.equal((await inTenant(B, (db) => db.query('SELECT 1 FROM current_consents'))).rowCount, 0);
  await admin.query(`CREATE VIEW leaky_consents AS SELECT tenant_id, subject_id FROM consents;
    GRANT SELECT ON leaky_consents TO app_user`);   // owned by a superuser, no security_invoker
  try {
    assert.ok((await inTenant(B, (db) => db.query('SELECT 1 FROM leaky_consents'))).rowCount! > 0);
  } finally {
    await admin.query('DROP VIEW leaky_consents');
  }
});

test('a request is done only with an outcome', async () => {
  const insert = (completed: string | null, outcome: string | null) => code(inTenant(A, (db) => db.query(
    `INSERT INTO privacy_requests (subject_id, kind, ack_due, due, completed_at, outcome)
     VALUES ($1, 'deletion', '2026-10-28', '2026-11-15', $2, $3)`, [customer, completed, outcome])));
  assert.equal(await insert('2026-11-01T00:00:00Z', null), '23514');
  assert.equal(await insert('2026-11-01T00:00:00Z', 'done'), 'ok');
});
