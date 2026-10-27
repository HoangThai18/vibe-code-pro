// src/db/pool.ts — one pool per process: utf8mb4, UTC, strict
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';

export function createAppPool(uri: string, options: mysql.PoolOptions = {}): Pool {
  const pool = mysql.createPool({
    uri,
    charset: 'utf8mb4_0900_ai_ci',   // mysql2's default is utf8mb4_unicode_ci, which differs from the columns
    timezone: 'Z',                   // mysql2 reads and writes DATETIME as UTC; the default is Node's local zone
    connectionLimit: 10,
    ...options,
  });
  // The session zone drives NOW(), CURRENT_TIMESTAMP and TIMESTAMP columns; the server default is SYSTEM (the host's).
  // Queued before the first query on each new connection. resetOnRelease would undo it (section 2).
  pool.pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'");
  });
  return pool;
}

// Run at startup: refuse to serve on a server or connection that would corrupt data silently
export async function checkSession(pool: Pool): Promise<void> {
  const [[s]] = await pool.query<RowDataPacket[]>(
    'SELECT @@sql_mode AS sqlMode, @@time_zone AS tz, @@collation_connection AS coll, VERSION() AS version');
  const missing = ['STRICT_TRANS_TABLES', 'ONLY_FULL_GROUP_BY', 'NO_ZERO_DATE', 'NO_ZERO_IN_DATE', 'ERROR_FOR_DIVISION_BY_ZERO']
    .filter((m) => !String(s!.sqlMode).split(',').includes(m));
  if (missing.length) throw new Error(`sql_mode lacks ${missing.join(', ')}`);
  if (s!.tz !== '+00:00') throw new Error(`session time_zone is ${s!.tz}, expected +00:00`);
  if (!String(s!.coll).startsWith('utf8mb4_')) throw new Error(`connection collation is ${s!.coll}`);
}
