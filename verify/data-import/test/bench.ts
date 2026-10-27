// Benchmark (not a test): 50,000-row CSV and xlsx, parse + validate + stage + apply. node --expose-gc --import tsx test/bench.ts
import ExcelJS from 'exceljs';
import { PgBoss } from 'pg-boss';
import { readCsv, readXlsx } from '../src/imports/read-file';
import { parseRows } from '../src/imports/rows';
import { applyBatch } from '../src/imports/apply';
import { confirmImport, previewImport } from '../src/imports/service';
import { setupImportQueues } from '../src/imports/worker';
import { A, APP_URL, adminPool, appPool, csv, resetDb } from './helpers';

const N = 50_000;
const rows = Array.from({ length: N }, (_, i) => [`Nguyễn Thị Khách Hàng ${i}`, `9${String(i).padStart(8, '0')}`, '03/04/1990', `khach${i}@example.com`]);
const csvData = csv(['Họ tên|Số điện thoại|Ngày sinh|Email', ...rows.map((r) => r.join('|'))]);
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('KH');
ws.addRow(['Họ tên', 'Số điện thoại', 'Ngày sinh', 'Email']);
for (const r of rows) ws.addRow([r[0], Number(r[1]), new Date(Date.UTC(1990, 3, 3)), r[3]]);
const xlsxData = new Uint8Array(await wb.xlsx.writeBuffer());
console.log(`CSV ${(csvData.byteLength / 1e6).toFixed(1)} MB, xlsx ${(xlsxData.byteLength / 1e6).toFixed(1)} MB`);

const gc = (globalThis as { gc?: () => void }).gc;
async function measure(label: string, fn: () => Promise<unknown>) {
  gc?.();
  const before = process.memoryUsage().heapUsed;
  let peak = before;
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 5);
  const start = performance.now();
  await fn();
  clearInterval(timer);
  peak = Math.max(peak, process.memoryUsage().heapUsed);
  console.log(`${label}: ${((performance.now() - start) / 1000).toFixed(2)} s, peak heap +${((peak - before) / 1e6).toFixed(0)} MB`);
}
await measure('parse+validate CSV 50k', () => parseRows(readCsv(csvData)));
await measure('parse+validate xlsx 50k', () => parseRows(readXlsx(xlsxData)));

resetDb();
const pool = appPool();
const admin = adminPool();
const boss = new PgBoss(APP_URL);
await boss.start();
await setupImportQueues(boss);
let batchId = '';
await measure('previewImport CSV 50k (parse + stage in DB)', async () => {
  batchId = (await previewImport(pool, boss, A, { name: 'b.csv', data: csvData })).batch.id;
});
await confirmImport(pool, boss, A, batchId, 'skip');
await measure('applyBatch 50k (chunks of 500)', () => applyBatch(pool, { tenantId: A, batchId }));
const { rows: [b] } = await admin.query('SELECT inserted, status FROM import_batches WHERE id = $1', [batchId]);
console.log('batch', b);
// Re-run with update on an identical re-export (all conflicts)
const csv2 = csv(['Họ tên|Số điện thoại|Ngày sinh|Email', ...rows.slice(1).map((r) => r.join('|')), 'Thêm|0977000000||']);
await measure('preview+apply 50k re-export with update', async () => {
  const p = await previewImport(pool, boss, A, { name: 'c.csv', data: csv2 });
  await confirmImport(pool, boss, A, p.batch.id, 'update');
  await applyBatch(pool, { tenantId: A, batchId: p.batch.id });
});
console.log((await admin.query('SELECT count(*) FROM customers')).rows[0]);
await boss.stop({ graceful: false });
await pool.end();
await admin.end();
