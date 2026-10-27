#!/usr/bin/env bash
# EF Core migrations on an empty database, as the table owner. verify.sh calls it with DATABASE_URL (a superuser).
set -euo pipefail
cd "$(dirname "$0")"
db="${DATABASE_URL##*/}" base="${DATABASE_URL%/*}"
q() { PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning" psql -X -q -v ON_ERROR_STOP=1 "$@"; }
# Npgsql takes keyword connection strings, not URLs
cs() { python3 -c 'import sys, urllib.parse as u; p = u.urlparse(sys.argv[1]); print(f"Host={p.hostname};Port={p.port or 5432};Database={p.path[1:]};Username={u.unquote(p.username)};Password={u.unquote(p.password or "")}")' "$1"; }
# Once per database, as a superuser: roles.sql (postgres-rls.md section 1) made re-runnable, the extension
admin() {
  sed -E -e 's/^CREATE ROLE ([a-z_]+) (.*);$/DO $$ BEGIN CREATE ROLE \1 \2; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;/' \
         -e "s/^ALTER ROLE ([a-z_]+) SET/ALTER ROLE \1 IN DATABASE ${1##*/} SET/" sql/roles.sql | q "$1" -f -
  q "$1" -c "CREATE EXTENSION IF NOT EXISTS btree_gist"
}

# 1. Bundle: one executable built in CI, run per environment with the owner's connection string (no SDK, no source)
admin "$DATABASE_URL"
dotnet ef migrations bundle --project src/Spa.Api --configuration Release --target-runtime linux-x64 \
  --output artifacts/efbundle --force
# Here: the superuser switched to app_owner. In production: Username=app_owner;Password=... from the secret store
Logging__LogLevel__Default=Warning artifacts/efbundle --connection "$(cs "$DATABASE_URL");Options=-c role=app_owner"
q "$DATABASE_URL" -f sql/tenant-ids.sql   # superuser: app_tenant_ids() owned by app_definer (postgres-rls.md section 3)

# 2. Idempotent script, for review or a DBA: applied twice to another empty database, same schema as the bundle
q "$base/postgres" -c "DROP DATABASE IF EXISTS ${db}_script" -c "CREATE DATABASE ${db}_script"
admin "$base/${db}_script"
dotnet ef migrations script --idempotent --project src/Spa.Api --configuration Release --no-build --output artifacts/migrations.sql
for _ in 1 2; do PGOPTIONS='-c role=app_owner' q "$base/${db}_script" -f artifacts/migrations.sql; done
q "$base/${db}_script" -f sql/tenant-ids.sql
# -w: the script re-indents raw SQL inside its DO $EF$ blocks, function bodies included
diff -w <(pg_dump --schema-only --no-owner "$DATABASE_URL" | grep -v '^\\') \
        <(pg_dump --schema-only --no-owner "$base/${db}_script" | grep -v '^\\')
q "$base/postgres" -c "DROP DATABASE ${db}_script"
