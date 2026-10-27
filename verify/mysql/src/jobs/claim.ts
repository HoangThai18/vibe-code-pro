// src/jobs/claim.ts — workers claim jobs with SKIP LOCKED (MySQL 8.0+)
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../db/tenant';
import type { Job } from './queue';

// A locking read locks what its plan reads: on a small table the optimizer's full scan locks every queued row
// and other workers claim nothing. Pin the (queue, status, run_at) index.
export const CLAIM = `SELECT id, tenant_id AS tenantId, payload, attempts FROM jobs FORCE INDEX (jobs_ready)
  WHERE queue = ? AND status = 'queued' AND run_at <= UTC_TIMESTAMP(3)
  ORDER BY run_at LIMIT ? FOR UPDATE SKIP LOCKED`;

// Short transaction: lock ready rows nobody else holds, mark them running, commit; work after the commit
export function claim<P>(pool: Pool, queue: string, limit = 10, leaseSeconds = 120): Promise<Job<P>[]> {
  return withTransaction(pool, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(CLAIM, [queue, limit]);
    if (rows.length === 0) return [];
    await conn.query(
      `UPDATE jobs SET status = 'running', attempts = attempts + 1,
              locked_until = UTC_TIMESTAMP(3) + INTERVAL ? SECOND WHERE id IN (?)`, [leaseSeconds, rows.map((r) => r.id)]);
    return rows as Job<P>[];
  });
}
