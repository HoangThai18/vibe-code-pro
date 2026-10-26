import type { Pool } from 'pg';
import { withTenant } from '../db';

// GET /v1/t/:tenantId/customers/search?q=
export async function searchCustomers(pool: Pool, tenantId: string, q: string) {
  return withTenant(pool, tenantId, async (db) => {
    const { rows } = await db.query(
      `SELECT id, full_name, phone FROM customers
        WHERE full_name ILIKE '%' || $1 || '%' OR phone LIKE '%' || $1 || '%'
        ORDER BY full_name LIMIT 20`,
      [q],
    );
    return rows;
  });
}
