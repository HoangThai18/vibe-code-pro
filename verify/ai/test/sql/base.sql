-- Test setup only (not in the docs): tables from the vibe-backend skill (multi-tenant.md, postgres-rls.md)
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_user;

CREATE FUNCTION app_current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE TABLE tenants (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE users (id uuid PRIMARY KEY, email text NOT NULL UNIQUE);
CREATE TABLE memberships (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  user_id   uuid NOT NULL REFERENCES users (id),
  role      text NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TABLE customers (
  tenant_id  uuid NOT NULL REFERENCES tenants (id),
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  full_name  text NOT NULL,
  phone      text,
  email      text,
  birthday   date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, phone)
);
CREATE TABLE customer_notes (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id)
);
