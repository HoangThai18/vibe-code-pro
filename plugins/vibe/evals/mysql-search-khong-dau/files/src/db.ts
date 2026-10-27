import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';

export const pool: Pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 10 });

// tenantId comes from /v1/t/:tenantId/..., after the membership check
export async function withTenant<T>(tenantId: string, fn: (db: PoolConnection, tenantId: string) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn, tenantId);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
