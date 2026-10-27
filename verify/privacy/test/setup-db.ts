// Builds the schema from an empty database as a migration would: roles, then tables as app_owner.
// roles.sql, current-tenant.sql, schema.sql are copies of verify/backend-core/sql (postgres-rls.md, multi-tenant.md).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function setupDatabase(url: string) {
  const db = new URL(url).pathname.slice(1);
  const psql = (args: string[], input?: string) => execFileSync('psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args],
    { input, stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
  psql(['-c', 'DROP SCHEMA IF EXISTS public CASCADE', '-c', 'CREATE SCHEMA public']);
  const roles = readFileSync('sql/roles.sql', 'utf8')
    .replace(/^CREATE ROLE (\w+) (.*);$/gm, (_, name: string, rest: string) =>
      `DO $$ BEGIN CREATE ROLE ${name} ${rest}; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;`)
    .replace(/^ALTER ROLE (\w+) SET/gm, `ALTER ROLE $1 IN DATABASE ${db} SET`);
  psql(['-f', '-'], roles);
  psql(['-c', 'SET ROLE app_owner', ...['current-tenant', 'schema', 'privacy'].flatMap((f) => ['-f', `sql/${f}.sql`])]);
}
