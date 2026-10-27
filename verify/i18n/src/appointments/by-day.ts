// src/appointments/by-day.ts — inside withTenant; day: 'YYYY-MM-DD' picked in the UI, or null for "today"
import type { PoolClient } from 'pg';

// Bounds = local midnights in the tenant zone (DST-safe). Scalar subqueries keep index (tenant_id, starts_at)
// in use; a join on tenants gave a seq scan (~55 ms vs ~0.3 ms on 200k rows).
export async function appointmentsOnDay(db: PoolClient, day: string | null) {
  const { rows } = await db.query<{ id: string; starts_at: Date }>(
    `WITH t AS (
       SELECT time_zone AS tz, COALESCE($1::date, (now() AT TIME ZONE time_zone)::date) AS d
         FROM tenants WHERE id = app_current_tenant()
     )
     SELECT id, starts_at FROM appointments
      WHERE starts_at >= (SELECT d::timestamp AT TIME ZONE tz FROM t)
        AND starts_at <  (SELECT (d + 1)::timestamp AT TIME ZONE tz FROM t)
      ORDER BY starts_at`,
    [day],
  );
  return rows;
}
