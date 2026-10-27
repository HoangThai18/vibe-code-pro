// apps/api/src/imports/service.ts
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { PgBoss } from 'pg-boss';
import { withTenant } from '../db/tenant';
import { readCsv, readXlsx } from './read-file';
import { detectFormat } from './upload';
import { columnLabel, parseRows } from './rows';

export const Q = { apply: 'import-apply', purge: 'import-purge' } as const;
export interface ImportJob { tenantId: string; batchId: string }
export type OnConflict = 'skip' | 'update';

const inTx = (db: PoolClient) => ({ db: { executeSql: (text: string, values?: unknown[]) => db.query(text, values) } });
const findBatch = async (db: PoolClient, sha256: string) =>
  (await db.query("SELECT * FROM import_batches WHERE kind = 'customers' AND file_sha256 = $1", [sha256])).rows[0];

// POST /v1/t/{tenantId}/imports: check, parse, validate and stage. Customers are not touched yet.
export async function previewImport(pool: Pool, boss: PgBoss, tenantId: string, file: { name: string; data: Uint8Array }) {
  const format = await detectFormat(file.data);
  const sha256 = createHash('sha256').update(file.data).digest('hex');
  const earlier = await withTenant(pool, tenantId, (db) => findBatch(db, sha256));
  if (earlier) return { batch: earlier, duplicate: true, errors: [] };      // same file again: show the earlier batch
  const { columns, header, rows } = await parseRows(format === 'xlsx' ? readXlsx(file.data) : readCsv(file.data));

  return withTenant(pool, tenantId, async (db) => {
    // An email another customer of this tenant already has: UNIQUE (tenant_id, email) would fail its chunk
    const emails = rows.flatMap((r) => (r.data?.email ? [r.data.email] : []));
    const { rows: owners } = await db.query<{ email: string; phone: string }>(
      'SELECT email, phone FROM customers WHERE email = ANY($1::text[])', [emails]);
    const ownerPhone = new Map(owners.map((o) => [o.email, o.phone]));
    for (const r of rows) {
      const owner = r.data?.email ? ownerPhone.get(r.data.email) : undefined;
      if (owner && owner !== r.data!.phone) {
        r.data = null;
        r.errors = [{ column: columnLabel(columns, 'email'), message: 'Email đã có ở khách hàng khác' }];
      }
    }
    const { rows: [batch] } = await db.query(
      `INSERT INTO import_batches (kind, file_sha256, file_name, header, total_rows, valid_rows)
       VALUES ('customers', $1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, kind, file_sha256) DO NOTHING RETURNING *`,
      [sha256, file.name, JSON.stringify(header), rows.length, rows.filter((r) => r.data).length],
    );
    if (!batch) return { batch: await findBatch(db, sha256), duplicate: true, errors: [] };   // a parallel upload won
    for (let i = 0; i < rows.length; i += 1000) {
      const part = rows.slice(i, i + 1000);
      const json = (pick: (r: (typeof part)[number]) => unknown) => part.map((r) => (pick(r) ? JSON.stringify(pick(r)) : null));
      await db.query(
        `INSERT INTO import_rows (batch_id, row_number, data, raw, errors)
         SELECT $1, * FROM unnest($2::int[], $3::jsonb[], $4::jsonb[], $5::jsonb[])`,
        [batch.id, part.map((r) => r.rowNumber), json((r) => r.data), json((r) => r.raw), json((r) => r.errors)],
      );
    }
    // Retention: 7 days after upload the staged rows go, whatever happened (purgeBatch)
    await boss.send(Q.purge, { tenantId, batchId: batch.id } satisfies ImportJob, { startAfter: 7 * 24 * 3600, ...inTx(db) });
    const errors = rows.filter((r) => r.errors).slice(0, 200).flatMap((r) => r.errors!.map((e) => ({ row: r.rowNumber, ...e })));
    return { batch, duplicate: false, columns, errors };
  });
}

// POST .../imports/{id}/confirm. Also resumes a failed batch. false -> 404 (other tenant) or 409 (already running/done)
export async function confirmImport(pool: Pool, boss: PgBoss, tenantId: string, batchId: string, onConflict: OnConflict) {
  return withTenant(pool, tenantId, async (db) => {
    const { rowCount } = await db.query(
      `UPDATE import_batches SET status = 'queued', on_conflict = $2 WHERE id = $1 AND status IN ('previewed', 'failed')`,
      [batchId, onConflict],
    );
    if (rowCount === 1) await boss.send(Q.apply, { tenantId, batchId } satisfies ImportJob, inTx(db));   // same transaction
    return rowCount === 1;
  });
}

// Last retry failed: the UI shows "Thử lại" (confirm again resumes at next_row)
export const markFailed = (pool: Pool, job: ImportJob) =>
  withTenant(pool, job.tenantId, (db) =>
    db.query("UPDATE import_batches SET status = 'failed' WHERE id = $1 AND status IN ('queued', 'applying')", [job.batchId]));

// Not done within 7 days (abandoned preview, failed): drop the batch. Done: keep counts and hash, drop the rows.
export const purgeBatch = (pool: Pool, job: ImportJob) =>
  withTenant(pool, job.tenantId, async (db) => {
    await db.query("DELETE FROM import_batches WHERE id = $1 AND status <> 'done'", [job.batchId]);
    await db.query('DELETE FROM import_rows WHERE batch_id = $1', [job.batchId]);
  });
