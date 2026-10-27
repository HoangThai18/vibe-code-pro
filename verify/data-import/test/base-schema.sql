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
DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO app_user', current_database()); END $$;   -- pg-boss creates its schema

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE TABLE tenants (id uuid PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'active');
INSERT INTO tenants VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Spa A'), ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Spa B');
GRANT SELECT ON tenants TO app_user;

CREATE TABLE customers (
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  full_name  text NOT NULL,
  phone      text NOT NULL,
  email      text,
  birthday   date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, email)                        -- not in the pack's example schema: an app that has it (rules 1)
);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
GRANT SELECT, INSERT, UPDATE, DELETE ON customers TO app_user;
