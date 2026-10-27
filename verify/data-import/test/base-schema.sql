-- Test fixture: the spa app's existing tables and roles, as in the vibe-backend RLS reference (not part of the doc)
\set ON_ERROR_STOP on
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS pgboss CASCADE;
CREATE SCHEMA public;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT CREATE ON DATABASE import_check TO app_user;   -- pg-boss creates its schema on first start

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE TABLE tenants (id uuid PRIMARY KEY, name text NOT NULL);
INSERT INTO tenants VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Spa A'), ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Spa B');
GRANT SELECT ON tenants TO app_user;

CREATE TABLE customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  full_name  text NOT NULL,
  phone      text NOT NULL,
  birthday   date,
  email      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
GRANT SELECT, INSERT, UPDATE, DELETE ON customers TO app_user;
