-- Once per environment, as a superuser (postgres-rls.md section 1), before the app's first start.
-- psql "$DATABASE_URL" -v db=verify_spring -f db/bootstrap.sql
-- Roles are shared by every database on the server: create them only if missing.
SELECT 'CREATE ROLE spring_owner LOGIN NOSUPERUSER NOBYPASSRLS'
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spring_owner')\gexec
SELECT 'CREATE ROLE spring_app LOGIN NOSUPERUSER NOBYPASSRLS'
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spring_app')\gexec
SELECT 'CREATE ROLE spring_definer NOLOGIN NOSUPERUSER BYPASSRLS'
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spring_definer')\gexec
ALTER ROLE spring_owner PASSWORD 'spring-owner-test';
ALTER ROLE spring_app PASSWORD 'spring-app-test';

-- Flyway (as spring_owner) creates btree_gist, a trusted extension: needs CREATE on the database
GRANT CONNECT, CREATE ON DATABASE :"db" TO spring_owner;
GRANT CONNECT ON DATABASE :"db" TO spring_app;
GRANT USAGE, CREATE ON SCHEMA public TO spring_owner;
GRANT USAGE ON SCHEMA public TO spring_app;
-- Lets the migration give app_tenant_ids() to the definer (ALTER ... OWNER TO needs SET ROLE rights on the new
-- owner, and the new owner needs CREATE on the schema)
GRANT spring_definer TO spring_owner;
GRANT USAGE, CREATE ON SCHEMA public TO spring_definer;

ALTER DEFAULT PRIVILEGES FOR ROLE spring_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO spring_app;
ALTER DEFAULT PRIVILEGES FOR ROLE spring_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO spring_app;
ALTER ROLE spring_app IN DATABASE :"db" SET statement_timeout = '5s';
