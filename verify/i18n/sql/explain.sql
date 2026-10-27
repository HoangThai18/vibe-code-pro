-- Run after the test suite (tables exist): 200k appointments, then EXPLAIN the day query as app_user
INSERT INTO appointments (tenant_id, customer_id, starts_at)
SELECT CASE WHEN g % 2 = 0 THEN 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid ELSE 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid END,
       CASE WHEN g % 2 = 0 THEN (SELECT id FROM customers WHERE tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' LIMIT 1)
            ELSE (SELECT id FROM customers WHERE tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' LIMIT 1) END,
       TIMESTAMPTZ '2025-01-01Z' + g * interval '7 minutes'
  FROM generate_series(1, 200000) g;
ANALYZE appointments;
BEGIN;
SET LOCAL ROLE app_user;
SELECT set_config('app.tenant_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)  -- the query in src/appointments/by-day.ts
WITH t AS (
  SELECT time_zone AS tz, COALESCE('2025-06-01'::date, (now() AT TIME ZONE time_zone)::date) AS d
    FROM tenants WHERE id = app_current_tenant()
)
SELECT id, starts_at FROM appointments
 WHERE starts_at >= (SELECT d::timestamp AT TIME ZONE tz FROM t)
   AND starts_at <  (SELECT (d + 1)::timestamp AT TIME ZONE tz FROM t)
 ORDER BY starts_at;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)  -- rejected variant: bounds from a join on tenants
WITH t AS (
  SELECT time_zone AS tz, COALESCE('2025-06-01'::date, (now() AT TIME ZONE time_zone)::date) AS d
    FROM tenants WHERE id = app_current_tenant()
)
SELECT a.id, a.starts_at FROM appointments a, t
 WHERE a.starts_at >= t.d::timestamp AT TIME ZONE t.tz
   AND a.starts_at <  (t.d + 1)::timestamp AT TIME ZONE t.tz
 ORDER BY a.starts_at;
COMMIT;
