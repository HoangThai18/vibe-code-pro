// Builds the schema from an empty database, in migration order, with the roles each step runs as
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export default function setup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL (a superuser) is required: verify/tools/run.sh backend-core');
  const db = new URL(url).pathname.slice(1);
  const psql = (args: string[], input?: string) =>
    execFileSync('psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], { input, stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });

  psql(['-c', 'DROP SCHEMA IF EXISTS public, private, auth CASCADE', '-c', 'CREATE SCHEMA public']);
  // roles.sql as shown in the reference, made re-runnable: roles are shared by every database on the server
  const roles = readFileSync('sql/roles.sql', 'utf8')
    .replace(/^CREATE ROLE (\w+) (.*);$/gm, (_, name: string, rest: string) =>
      `DO $$ BEGIN CREATE ROLE ${name} ${rest}; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;`)
    .replace(/^ALTER ROLE (\w+) SET/gm, `ALTER ROLE $1 IN DATABASE ${db} SET`);
  psql(['-f', '-'], roles);
  psql(['-c', 'CREATE EXTENSION IF NOT EXISTS btree_gist']);   // migrations' admin step
  const asOwner = ['current-tenant', 'schema', 'tenant-isolation', 'login', 'member-role', 'no-overlap',
    'tenant-domains', 'audit-log', 'api-keys', 'native-auth', 'idempotency',
    'custom-roles', 'role-permissions', 'role-bits', 'branches'];   // permissions.md; data-scope.sql: per test file
  psql(['-c', 'SET ROLE app_owner', ...asOwner.flatMap((f) => ['-f', `sql/${f}.sql`])]);
  psql(['-f', 'sql/tenant-ids.sql']);   // superuser: hands the function to app_definer
  // Supabase: stub of its auth schema, then the reference's SQL as Supabase's postgres role (here: superuser)
  psql(['-f', 'test/support/supabase-stub.sql', '-f', 'sql/supabase.sql', '-f', 'sql/supabase-own-rows.sql',
    '-c', 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes, public.customers TO authenticated']);
}
