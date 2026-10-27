// apps/api/src/security/rate-limit.ts
import type { Pool, PoolClient } from 'pg';

// Fixed window counted in Postgres: correct across multiple app instances, no extra Redis needed
export async function hitRateLimit(db: Pool | PoolClient, key: string, limit: number, windowSeconds: number) {
  const { rows } = await db.query<{ count: number; retry_after: number }>(
    `INSERT INTO rate_limits (key, window_start, count)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count, ceil(extract(epoch FROM window_start + make_interval(secs => $2) - now()))::int AS retry_after`,
    [key, windowSeconds],
  );
  const row = rows[0]!;
  return { allowed: row.count <= limit, retryAfterSeconds: Math.max(1, row.retry_after) };
}
