// apps/api/src/imports/apply.ts — the import-apply job
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant';
import type { ImportJob, OnConflict } from './service';

const upsertSql = (onConflict: OnConflict) => `
  WITH chunk AS (
    SELECT row_number, data FROM import_rows
     WHERE batch_id = $1 AND row_number > $2 AND data IS NOT NULL
     ORDER BY row_number LIMIT $3
  ), written AS (
    INSERT INTO customers (full_name, phone, birthday, email)
    SELECT data->>'fullName', data->>'phone', (data->>'birthday')::date, data->>'email' FROM chunk
    ON CONFLICT (tenant_id, phone) DO ${onConflict === 'update'
      ? `UPDATE SET full_name = EXCLUDED.full_name,
                    birthday = COALESCE(EXCLUDED.birthday, customers.birthday),
                    email = COALESCE(EXCLUDED.email, customers.email)`
      : 'NOTHING'}
    RETURNING xmax = 0 AS inserted              -- 0: a new row, not an update
  )
  SELECT (SELECT max(row_number) FROM chunk) AS last_row,
         (SELECT count(*) FROM chunk)::int AS total,
         (SELECT count(*) FROM written WHERE inserted)::int AS inserted,
         (SELECT count(*) FROM written WHERE NOT inserted)::int AS updated`;

// One chunk = one transaction with its progress: after a crash, a retry or beside a second worker
// (FOR UPDATE waits), work resumes after next_row and no row counts twice
export async function applyBatch(pool: Pool, job: ImportJob, chunkSize = 500): Promise<void> {
  for (let finished = false; !finished; ) {
    finished = await withTenant(pool, job.tenantId, async (db) => {
      const { rows: [b] } = await db.query<{ status: string; on_conflict: OnConflict; next_row: number }>(
        'SELECT status, on_conflict, next_row FROM import_batches WHERE id = $1 FOR UPDATE', [job.batchId]);
      if (!b || (b.status !== 'queued' && b.status !== 'applying')) return true;   // other tenant (RLS), done, not confirmed
      const { rows: [r] } = await db.query<{ last_row: number | null; total: number; inserted: number; updated: number }>(
        upsertSql(b.on_conflict), [job.batchId, b.next_row, chunkSize]);
      if (!r || r.last_row === null) {
        await db.query("UPDATE import_batches SET status = 'done', finished_at = now() WHERE id = $1", [job.batchId]);
        await db.query('DELETE FROM import_rows WHERE batch_id = $1 AND data IS NOT NULL', [job.batchId]);   // keep rejected rows only
        return true;
      }
      await db.query(
        `UPDATE import_batches SET status = 'applying', next_row = $2,
                inserted = inserted + $3, updated = updated + $4, skipped = skipped + $5 WHERE id = $1`,
        [job.batchId, r.last_row, r.inserted, r.updated, r.total - r.inserted - r.updated]);
      return false;
    });
  }
}
