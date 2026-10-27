-- Test scaffolding: spa schema with FORCE RLS, as in vibe-backend postgres-rls.md (not part of the reference)
-- Run as superuser on the test database (npm run db:setup, from verify/tools/run.sh).
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

DO $$ BEGIN
  CREATE ROLE rt_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE rt_app LOGIN PASSWORD 'rt' NOSUPERUSER NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT ALL ON SCHEMA public TO rt_owner;
GRANT USAGE ON SCHEMA public TO rt_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rt_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rt_app;
ALTER ROLE rt_app SET statement_timeout = '5s';

SET ROLE rt_owner;

CREATE FUNCTION app_current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;
CREATE FUNCTION app_current_user() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE TABLE tenants (
  id   uuid PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE users (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL
);
CREATE TABLE memberships (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  user_id   uuid NOT NULL REFERENCES users (id),
  role      text NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX memberships_user ON memberships (user_id);
-- Server-side sessions (auth.md): global, no tenant
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE customers (
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  full_name  text NOT NULL,
  phone      text NOT NULL,
  email      text,
  birthday   date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, phone)
);
CREATE TABLE appointments (
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL,
  staff_user_id uuid NOT NULL REFERENCES users (id),   -- the app: memberships (tenant_id, user_id); tests delete members
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL CHECK (ends_at > starts_at),
  status        text NOT NULL DEFAULT 'booked'
                CHECK (status IN ('booked', 'confirmed', 'done', 'cancelled', 'no_show')),
  version       integer NOT NULL DEFAULT 1,   -- for realtime events
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id)
);
CREATE INDEX appointments_tenant_starts ON appointments (tenant_id, starts_at);
CREATE INDEX appointments_customer ON appointments (tenant_id, customer_id);
CREATE INDEX appointments_staff ON appointments (staff_user_id);
-- In-app notifications for one staff member
CREATE TABLE user_notifications (
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id),
  kind           text NOT NULL,
  appointment_id uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  read_at        timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX user_notifications_inbox ON user_notifications (tenant_id, user_id, created_at DESC);
CREATE INDEX user_notifications_appointment ON user_notifications (tenant_id, appointment_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'appointments', 'user_notifications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = (SELECT app_current_tenant())) WITH CHECK (tenant_id = (SELECT app_current_tenant()))', t);
  END LOOP;
END $$;

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON memberships FOR SELECT
  USING (tenant_id = (SELECT app_current_tenant()) OR user_id = (SELECT app_current_user()));
CREATE POLICY membership_insert ON memberships FOR INSERT WITH CHECK (tenant_id = (SELECT app_current_tenant()));
CREATE POLICY membership_update ON memberships FOR UPDATE
  USING (tenant_id = (SELECT app_current_tenant())) WITH CHECK (tenant_id = (SELECT app_current_tenant()));
CREATE POLICY membership_delete ON memberships FOR DELETE USING (tenant_id = (SELECT app_current_tenant()));

RESET ROLE;
