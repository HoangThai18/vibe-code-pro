-- Migrations (DDL) run as the table owner; the app never connects as it
CREATE ROLE app_owner LOGIN PASSWORD 'change-me' NOSUPERUSER;
GRANT USAGE, CREATE ON SCHEMA public TO app_owner;

CREATE ROLE app_user LOGIN PASSWORD 'change-me' NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
-- Tables and sequences created later by migrations (app_owner). FOR ROLE is required: without it
-- the defaults apply only to objects created by whoever runs this command (e.g. admin), not app_owner.
-- These defaults include UPDATE and DELETE: append-only and read-only tables revoke them (below).
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
-- Stop hung queries from affecting other tenants
ALTER ROLE app_user SET statement_timeout = '5s';

-- Backup and backfill (Postgres 14+): the predefined roles pg_read_all_data/pg_write_all_data cover every table,
-- including ones created later, so new tables don't cause "permission denied". Creating BYPASSRLS roles requires superuser.
CREATE ROLE app_backup LOGIN PASSWORD 'change-me' BYPASSRLS;
GRANT pg_read_all_data TO app_backup;
CREATE ROLE app_maintenance LOGIN PASSWORD 'change-me' BYPASSRLS;
GRANT pg_read_all_data, pg_write_all_data TO app_maintenance;

-- Owns the few SECURITY DEFINER functions (app_tenant_ids, section 3). NOLOGIN: nobody connects as it.
CREATE ROLE app_definer NOLOGIN NOSUPERUSER BYPASSRLS;
GRANT USAGE ON SCHEMA public TO app_definer;
