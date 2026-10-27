// src/jobs/purge-idempotency-keys.ts — daily job (references/jobs.md)
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant';

export async function purgeIdempotencyKeys(pool: Pool): Promise<number> {
  const { rows: tenants } = await pool.query<{ id: string }>('SELECT id FROM app_tenant_ids() AS id');
  let deleted = 0;
  for (const t of tenants) {
    const res = await withTenant(pool, t.id, (db) =>
      db.query("DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'"));
    deleted += res.rowCount ?? 0;
  }
  return deleted;
}
