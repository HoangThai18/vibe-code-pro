// test/import.test.ts — real Postgres, app role without BYPASSRLS: node --import tsx --test --test-concurrency=1
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, beforeEach, test } from 'node:test';
import { PgBoss } from 'pg-boss';
import { withTenant } from '../src/db/tenant';
import { errorReportCsv } from '../src/imports/report';
import { applyBatch } from '../src/imports/apply';
import { confirmImport, previewImport, purgeBatch, Q } from '../src/imports/service';
import { setupImportQueues, startImportWorker } from '../src/imports/worker';
import { A, APP_URL, B, adminPool, appPool, csv, resetDb, waitFor } from './helpers';

const pool = appPool();
const admin = adminPool();
let boss: PgBoss;

const customers = (n: number, from = 0, name = (i: number) => `Khách ${i}`) =>
  Array.from({ length: n }, (_, k) => `${name(from + k)}|9${String(from + k).padStart(8, '0')}|01/01/1990`);
const file = (lines: string[]) => ({ name: 'khach-cu.csv', data: csv(['Họ tên|SĐT|Ngày sinh', ...lines]) });
const count = (tenantId: string) =>
  withTenant(pool, tenantId, async (db) => Number((await db.query('SELECT count(*) FROM customers')).rows[0].count));
const batchRow = (tenantId: string, id: string) =>
  withTenant(pool, tenantId, async (db) => (await db.query('SELECT * FROM import_batches WHERE id = $1', [id])).rows[0]);

async function importNow(tenantId: string, f: { name: string; data: Uint8Array }, onConflict: 'skip' | 'update' = 'skip') {
  const preview = await previewImport(pool, boss, tenantId, f);
  assert.ok(await confirmImport(pool, boss, tenantId, preview.batch.id, onConflict));
  await applyBatch(pool, { tenantId, batchId: preview.batch.id }, 100);
  return batchRow(tenantId, preview.batch.id);
}

before(async () => {
  resetDb();
  boss = new PgBoss(APP_URL);
  boss.on('error', console.error);
  await boss.start();
});
after(async () => {
  await boss.stop({ graceful: false });
  await pool.end();
  await admin.end();
});
beforeEach(async () => {
  await admin.query('TRUNCATE customers, import_batches CASCADE');
  for (const q of Object.values(Q)) await boss.deleteQueue(q);
  await setupImportQueues(boss, { heartbeatSeconds: 10, retryDelay: 1 });
});

test('preview: errors carry the Excel row number and column; nothing written before confirm', async () => {
  const preview = await previewImport(pool, boss, A, file([...customers(2), 'Lê Văn C|12345|31/02/1990', '|0912000111|']));
  assert.deepEqual(preview.errors, [
    { row: 4, column: 'SĐT (B)', message: 'SĐT không hợp lệ (ví dụ 0912345678)' },
    { row: 4, column: 'Ngày sinh (C)', message: 'Ngày không tồn tại (ví dụ 31/02)' },
    { row: 5, column: 'Họ tên (A)', message: 'Thiếu họ tên' },
  ]);
  assert.equal(preview.batch.valid_rows, 2);
  assert.equal(await count(A), 0);
});

test('idempotent: same file twice is the same batch; a re-export updates instead of duplicating', async () => {
  const first = await importNow(A, file(customers(300)));
  assert.deepEqual([first.status, first.inserted, await count(A)], ['done', 300, 300]);

  const again = await previewImport(pool, boss, A, file(customers(300)));
  assert.equal(again.duplicate, true);
  assert.equal(again.batch.id, first.id);

  const reexport = await importNow(A, file(customers(301, 0, (i) => `Khách mới ${i}`)), 'update');
  assert.deepEqual([reexport.inserted, reexport.updated, await count(A)], [1, 300, 301]);
  const skip = await importNow(A, file([...customers(301), 'Thêm|0977000000|']), 'skip');
  assert.deepEqual([skip.inserted, skip.skipped, await count(A)], [1, 301, 302]);
});

test('crash inside a chunk: the chunk rolls back, the rerun resumes and applies every row once', async () => {
  const preview = await previewImport(pool, boss, A, file(customers(350, 0, (i) => (i === 250 ? 'CRASH' : `Khách ${i}`))));
  await confirmImport(pool, boss, A, preview.batch.id, 'skip');
  await admin.query(`CREATE FUNCTION crash() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.full_name = 'CRASH' THEN RAISE EXCEPTION 'mất kết nối giữa chừng'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER crash BEFORE INSERT ON customers FOR EACH ROW EXECUTE FUNCTION crash()`);
  try {
    await assert.rejects(applyBatch(pool, { tenantId: A, batchId: preview.batch.id }, 100), /mất kết nối/);
    const half = await batchRow(A, preview.batch.id);
    assert.deepEqual([half.next_row, half.inserted, await count(A)], [201, 200, 200]);   // rows 2..201 committed
  } finally {
    await admin.query('DROP TRIGGER crash ON customers; DROP FUNCTION crash()');
  }
  await applyBatch(pool, { tenantId: A, batchId: preview.batch.id }, 100);
  const done = await batchRow(A, preview.batch.id);
  assert.deepEqual([done.status, done.inserted, done.updated, done.skipped, await count(A)], ['done', 350, 0, 0, 350]);
});

test('worker killed with SIGKILL mid-file: pg-boss retries the job and it resumes at next_row', async () => {
  await admin.query(`CREATE FUNCTION slow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.005); RETURN NEW; END $$;
    CREATE TRIGGER slow BEFORE INSERT ON customers FOR EACH ROW EXECUTE FUNCTION slow()`);
  const child = spawn(process.execPath, ['--import', 'tsx', new URL('./kill-worker.ts', import.meta.url).pathname], { stdio: 'inherit' });
  const monitor = new PgBoss({ connectionString: APP_URL, superviseIntervalSeconds: 1, monitorIntervalSeconds: 1 });
  try {
    const preview = await previewImport(pool, boss, A, file(customers(1500)));
    await confirmImport(pool, boss, A, preview.batch.id, 'skip');
    await waitFor(async () => (await batchRow(A, preview.batch.id)).next_row > 0);
    child.kill('SIGKILL');
    await admin.query('DROP TRIGGER slow ON customers; DROP FUNCTION slow()');
    const partial = await batchRow(A, preview.batch.id);
    assert.ok(partial.status === 'applying' && partial.inserted < 1500, `${partial.status} ${partial.inserted}`);

    await monitor.start();
    await startImportWorker(monitor, pool, { heartbeatSeconds: 10, retryDelay: 1 });
    await waitFor(async () => (await batchRow(A, preview.batch.id)).status === 'done', 60_000);
    const done = await batchRow(A, preview.batch.id);
    assert.deepEqual([done.inserted, done.updated, done.skipped, await count(A)], [1500, 0, 0, 1500]);
    const { rows: [job] } = await admin.query('SELECT retry_count, state FROM pgboss.job WHERE name = $1', [Q.apply]);
    assert.deepEqual([job.retry_count, job.state], [1, 'completed']);              // the killed attempt + one retry
  } finally {
    child.kill('SIGKILL');
    await monitor.stop({ graceful: false });
  }
});

test('two workers on the same batch: FOR UPDATE serializes chunks, each row counted once', async () => {
  const preview = await previewImport(pool, boss, A, file(customers(400)));
  await confirmImport(pool, boss, A, preview.batch.id, 'update');
  const job = { tenantId: A, batchId: preview.batch.id };
  await Promise.all([applyBatch(pool, job, 50), applyBatch(pool, job, 50)]);
  const done = await batchRow(A, preview.batch.id);
  assert.deepEqual([done.inserted, done.updated, await count(A)], [400, 0, 400]);
});

test('tenant isolation: rows never land in another tenant', async () => {
  const { rows: [me] } = await pool.query('SELECT current_user, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user');
  assert.deepEqual(me, { current_user: 'app_user', rolbypassrls: false, rolsuper: false });
  // A 'tenant_id' column in the file is not a mapped column: ignored
  const fileA = { name: 'x.csv', data: csv(['Họ tên|SĐT|tenant_id', `Lan|0912345678|${B}`]) };
  const preview = await previewImport(pool, boss, A, fileA);
  await confirmImport(pool, boss, A, preview.batch.id, 'skip');
  // A job claiming tenant B for A's batch: RLS hides the batch, nothing happens
  await applyBatch(pool, { tenantId: B, batchId: preview.batch.id });
  assert.equal((await batchRow(A, preview.batch.id)).status, 'queued');
  assert.equal(await confirmImport(pool, boss, B, preview.batch.id, 'skip'), false);
  assert.equal(await errorReportCsv(pool, B, preview.batch.id), null);
  await applyBatch(pool, { tenantId: A, batchId: preview.batch.id });
  assert.deepEqual([await count(A), await count(B)], [1, 0]);
  // B uploading the same file is not "a duplicate": hashes are per tenant
  assert.equal((await previewImport(pool, boss, B, fileA)).duplicate, false);
  // Even hand-written SQL in A's context cannot write B's rows
  await assert.rejects(
    withTenant(pool, A, (db) => db.query("INSERT INTO customers (tenant_id, full_name, phone) VALUES ($1, 'X', '0900000000')", [B])),
    /row-level security/);
});

test('error report: rejected rows only, formula cells escaped, fixable and re-uploadable', async () => {
  const evil = '=HYPERLINK("http://evil.example","Bấm vào")';
  const done = await importNow(A, file([...customers(2), `"${evil.replaceAll('"', '""')}"|0912|`, '-Lan|abc|']));
  const report = (await errorReportCsv(pool, A, done.id))!;
  assert.equal(report.split('\r\n')[0], '\uFEFF"Họ tên","SĐT","Ngày sinh","Dòng gốc","Lỗi"');
  assert.equal(report.split('\r\n')[1], `"'=HYPERLINK(""http://evil.example"",""Bấm vào"")","0912","","4","SĐT (B): SĐT không hợp lệ (ví dụ 0912345678)"`);
  assert.match(report.split('\r\n')[2]!, /^"'-Lan","abc"/);

  const fixed = report.replace('"0912"', '"0912345670"').replace('"abc"', '"0912345671"');
  const reimport = await importNow(A, { name: 'loi.csv', data: new TextEncoder().encode(fixed) });
  assert.deepEqual([reimport.inserted, reimport.total_rows - reimport.valid_rows, await count(A)], [2, 0, 4]);
  const names = await withTenant(pool, A, async (db) =>
    (await db.query("SELECT full_name FROM customers WHERE phone IN ('0912345670', '0912345671') ORDER BY phone")).rows);
  assert.deepEqual(names.map((r) => r.full_name), [evil, '-Lan']);   // stored as text; escaped again on every export
});

test('retention: applied rows go at the end, the rest 7 days after upload', async () => {
  const done = await importNow(A, file([...customers(3), 'X|1|']));
  const left = await withTenant(pool, A, async (db) => (await db.query('SELECT row_number FROM import_rows')).rows);
  assert.deepEqual(left, [{ row_number: 5 }]);                                   // only the rejected row, for the report
  const { rows: [purge] } = await admin.query(
    "SELECT data, extract(epoch FROM start_after - created_on) AS delay FROM pgboss.job WHERE name = $1", [Q.purge]);
  assert.deepEqual([purge.data, Math.round(Number(purge.delay) / 3600)], [{ tenantId: A, batchId: done.id }, 168]);

  await purgeBatch(pool, purge.data);
  assert.equal((await admin.query('SELECT count(*) FROM import_rows')).rows[0].count, '0');
  assert.equal((await batchRow(A, done.id)).status, 'done');                     // counts and hash stay
  const abandoned = await previewImport(pool, boss, A, file(customers(1, 900)));
  await purgeBatch(pool, { tenantId: A, batchId: abandoned.batch.id });
  assert.equal(await batchRow(A, abandoned.batch.id), undefined);                // never confirmed: gone entirely
});
