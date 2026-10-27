// apps/api/src/db/tenant.ts — as in the vibe-backend skill, references/postgres-rls.md section 4
import type { Pool, PoolClient } from 'pg';

export async function withTenant<T>(pool: Pool, tenantId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
