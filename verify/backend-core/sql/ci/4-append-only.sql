-- List every append-only and read-only table here when you create it
SELECT t.name, t.kind, p.priv
FROM (VALUES ('audit_log', 'append-only'), ('tenant_domains', 'read-only')) AS t(name, kind)
CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
WHERE (p.priv <> 'INSERT' OR t.kind = 'read-only')
  AND CASE WHEN p.priv IN ('INSERT', 'UPDATE')
           THEN has_any_column_privilege('app_user', 'public.' || t.name, p.priv)   -- table or column grants
           ELSE has_table_privilege('app_user', 'public.' || t.name, p.priv) END
ORDER BY t.name, p.priv;
