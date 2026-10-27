-- 0. Control: tenant B context sees B's rows (if 0, the checks below prove nothing)
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_b', true);
SELECT count(*) > 0 AS should_be_true FROM customers WHERE tenant_id = :'tenant_b';
ROLLBACK;

-- 1. No context → 0 rows
BEGIN;
SELECT count(*) AS should_be_zero FROM customers;
ROLLBACK;

-- 2. Tenant A context → B's rows not visible
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_a', true);
SELECT count(*) AS should_be_zero FROM customers WHERE tenant_id = :'tenant_b';
ROLLBACK;

-- 3. Tenant A context → cannot insert a row with tenant B (policy violation error)
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_a', true);
INSERT INTO customers (tenant_id, full_name, phone) VALUES (:'tenant_b', 'Lậu', '0900000000');
ROLLBACK;
