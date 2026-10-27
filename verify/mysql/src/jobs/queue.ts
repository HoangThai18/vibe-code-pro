// src/jobs/queue.ts — enqueue in the business transaction; finish, retry with backoff, requeue expired leases
import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';

export interface Job<P = unknown> { id: number; tenantId: string; payload: P; attempts: number }

export async function enqueue(conn: PoolConnection, tenantId: string, queue: string, payload: unknown): Promise<void> {
  await conn.query('INSERT INTO jobs (tenant_id, queue, payload) VALUES (?, ?, ?)', [tenantId, queue, JSON.stringify(payload)]);
}

export async function finish(pool: Pool, job: Job, error?: unknown, maxAttempts = 5): Promise<void> {
  if (!error) {
    await pool.query("UPDATE jobs SET status = 'done', locked_until = NULL WHERE id = ?", [job.id]);
    return;
  }
  const dead = job.attempts + 1 >= maxAttempts;
  await pool.query<ResultSetHeader>(
    `UPDATE jobs SET status = ?, run_at = UTC_TIMESTAMP(3) + INTERVAL ? SECOND, locked_until = NULL, last_error = ?
      WHERE id = ?`, [dead ? 'dead' : 'queued', 30 * 2 ** job.attempts, String(error).slice(0, 1000), job.id]);
}

// A worker that died mid-job: its lease expired, put the job back (run this every minute)
export async function requeueExpired(pool: Pool): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE jobs SET status = 'queued' WHERE status = 'running' AND locked_until < UTC_TIMESTAMP(3)");
  return res.affectedRows;
}
