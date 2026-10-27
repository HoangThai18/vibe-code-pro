CREATE TABLE tenant_domains (
  slug      text PRIMARY KEY,          -- e.g. 'spa-hoa-mai' or 'hoamai.example.com'
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);
-- Read-only. ALTER DEFAULT PRIVILEGES in section 1 already granted app_user write access on every new table,
-- so revoke it: this table has no RLS, and write access means repointing another tenant's slug to your own.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON tenant_domains FROM app_user;
GRANT SELECT ON tenant_domains TO app_user;
-- Adding/changing slugs: a separate admin flow (another role or a permission-checked function), with audit log
