import type { RowDataPacket } from 'mysql2/promise';
import { withTenant } from '../db';

// GET /v1/t/:tenantId/customers/search?q=
export async function searchCustomers(tenantId: string, q: string) {
  return withTenant(tenantId, async (db, tid) => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, full_name, phone FROM customers
        WHERE tenant_id = ? AND (full_name LIKE CONCAT('%', ?, '%') OR phone LIKE CONCAT('%', ?, '%'))
        ORDER BY full_name LIMIT 20`,
      [tid, q, q],
    );
    return rows;
  });
}
