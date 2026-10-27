SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relname NOT IN ('tenant_domains')   -- tables deliberately exempt from RLS
  AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
