-- Push devices for staff who work in several spas. Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/devices.test.sql (from verify/mobile)
\set QUIET on
\o /dev/null
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO app_user;

-- Minimal setup from the vibe-backend skill (postgres-rls.md sections 2-3)
CREATE FUNCTION app_current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE FUNCTION app_current_user() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
CREATE TABLE tenants (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE users (id uuid PRIMARY KEY, full_name text NOT NULL);
CREATE TABLE memberships (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  user_id   uuid NOT NULL REFERENCES users (id),
  role      text NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON memberships FOR SELECT
  USING (tenant_id = (SELECT app_current_tenant()) OR user_id = (SELECT app_current_user()));
CREATE POLICY membership_delete ON memberships FOR DELETE USING (tenant_id = (SELECT app_current_tenant()));

\i sql/devices.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

INSERT INTO tenants VALUES ('a0000000-0000-0000-0000-00000000000a', 'Spa Hoa Mai'), ('b0000000-0000-0000-0000-00000000000b', 'Spa Bạch Dương'),
  ('c0000000-0000-0000-0000-00000000000c', 'Spa Sen');
INSERT INTO users VALUES ('11111111-1111-1111-1111-111111111111', 'Nguyễn Thị Lan'), ('22222222-2222-2222-2222-222222222222', 'Trần Văn Minh');
INSERT INTO memberships VALUES
  ('a0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'staff'),
  ('b0000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'staff'),
  ('a0000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'staff');

CREATE FUNCTION assert_eq(actual text, expected text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'FAIL %: got %, expected %', label, actual, expected; END IF;
  RAISE NOTICE 'ok %', label;
END $$;

\set register `cat sql/register-device.sql`
\set unregister `cat sql/unregister-device.sql`
\set member_devices `cat sql/member-devices.sql`

SET ROLE app_user;
PREPARE register_device (text, uuid, text) AS :register
PREPARE unregister_device (text, uuid) AS :unregister
PREPARE member_devices (uuid) AS :member_devices

\set lan '\'11111111-1111-1111-1111-111111111111\''
\set minh '\'22222222-2222-2222-2222-222222222222\''
\set spa_a '\'a0000000-0000-0000-0000-00000000000a\''
\set spa_b '\'b0000000-0000-0000-0000-00000000000b\''
\set spa_c '\'c0000000-0000-0000-0000-00000000000c\''

-- Lan works in spa A and spa B and registers her phone once
EXECUTE register_device('ExponentPushToken[lan-phone]', :lan, 'ios');
EXECUTE register_device('ExponentPushToken[lan-phone]', :lan, 'ios');   -- every app start: no duplicate

BEGIN; SELECT set_config('app.tenant_id', :spa_a, true);
CREATE TEMP TABLE got ON COMMIT DROP AS EXECUTE member_devices(:lan);
SELECT assert_eq((SELECT string_agg(push_token, ',') FROM got), 'ExponentPushToken[lan-phone]', 'spa A reaches Lan');
COMMIT;
BEGIN; SELECT set_config('app.tenant_id', :spa_b, true);
CREATE TEMP TABLE got ON COMMIT DROP AS EXECUTE member_devices(:lan);
SELECT assert_eq((SELECT string_agg(push_token, ',') FROM got), 'ExponentPushToken[lan-phone]', 'spa B reaches Lan too');
COMMIT;
BEGIN; SELECT set_config('app.tenant_id', :spa_c, true);
CREATE TEMP TABLE got ON COMMIT DROP AS EXECUTE member_devices(:lan);
SELECT assert_eq((SELECT count(*)::text FROM got), '0', 'spa C (not her spa) cannot reach Lan');
COMMIT;

-- Lan leaves spa B: spa B no longer reaches her, spa A still does
BEGIN; SELECT set_config('app.tenant_id', :spa_b, true);
DELETE FROM memberships WHERE user_id = :lan;
CREATE TEMP TABLE got ON COMMIT DROP AS EXECUTE member_devices(:lan);
SELECT assert_eq((SELECT count(*)::text FROM got), '0', 'spa B stops after Lan leaves');
COMMIT;
BEGIN; SELECT set_config('app.tenant_id', :spa_a, true);
CREATE TEMP TABLE got ON COMMIT DROP AS EXECUTE member_devices(:lan);
SELECT assert_eq((SELECT count(*)::text FROM got), '1', 'spa A still reaches Lan');
COMMIT;

-- Shared counter phone: Minh signs in on Lan's phone without Lan logging out (e.g. session expired)
EXECUTE register_device('ExponentPushToken[lan-phone]', :minh, 'ios');
BEGIN; SELECT set_config('app.tenant_id', :spa_a, true);
CREATE TEMP TABLE got ON COMMIT DROP AS EXECUTE member_devices(:lan);
SELECT assert_eq((SELECT count(*)::text FROM got), '0', 'Lan''s pushes no longer go to the phone Minh now uses');
COMMIT;
BEGIN; SELECT set_config('app.tenant_id', :spa_a, true);
CREATE TEMP TABLE got ON COMMIT DROP AS EXECUTE member_devices(:minh);
SELECT assert_eq((SELECT count(*)::text FROM got), '1', 'Minh gets his');
COMMIT;

-- Logout: Lan cannot remove Minh's registration; Minh's logout removes the one row
EXECUTE unregister_device('ExponentPushToken[lan-phone]', :lan);
SELECT assert_eq((SELECT count(*)::text FROM devices), '1', 'another user''s logout deletes nothing');
EXECUTE unregister_device('ExponentPushToken[lan-phone]', :minh);
SELECT assert_eq((SELECT count(*)::text FROM devices), '0', 'logout deletes the device row');
RESET ROLE;
\o
\echo devices.test.sql: all checks passed
