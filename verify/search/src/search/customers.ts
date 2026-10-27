import type { Pool } from 'pg';
import { withTenant } from '../db/tenant';

export type CustomerHit = { id: string; fullName: string };

// GET /v1/t/{tenantId}/customers/search?q=... (membership already checked by the tenant middleware)
export async function searchCustomers(pool: Pool, tenantId: string, q: string): Promise<CustomerHit[]> {
  const query = q.normalize('NFC').trim().slice(0, 100);
  if (query.length < 2) return [];
  return withTenant(pool, tenantId, async (db) => {
    const { rows } = await db.query<{ id: string; full_name: string }>(
      'SELECT id, full_name FROM search_customers($1, 20)',
      [query],
    );
    return rows.map((r) => ({ id: r.id, fullName: r.full_name }));
  });
}
