// Nightly export for the accounting system: one consistent snapshot of yesterday's appointments
import type { Pool } from 'mysql2/promise';

export async function exportAppointments(pool: Pool, write: (row: unknown) => Promise<void>) {
  const conn = await pool.getConnection();
  try {
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    const stream = conn.connection.query(
      `SELECT tenant_id, id, customer_id, staff_user_id, starts_at, ends_at, status FROM appointments
        WHERE starts_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY`).stream();
    for await (const row of stream) await write(row);   // about 15 minutes
    await conn.query('COMMIT');
  } finally {
    conn.release();
  }
}
