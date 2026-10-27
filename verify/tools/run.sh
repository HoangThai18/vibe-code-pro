#!/usr/bin/env bash
# Run one verification project against a fresh database.
#   PG_URL=postgres://user:pass@localhost:5432 verify/tools/run.sh payments
# PG_URL needs a superuser: the tests create roles (app_user...) and reset the schema.
set -euo pipefail
project="$1"
base="${PG_URL:-postgres://postgres:postgres@localhost:5432}"
db="verify_${project//-/_}"
psql "$base/postgres" -q -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db"
# The app role most projects use; pg-boss (run as that role) needs CREATE on the database
psql "$base/$db" -q -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN CREATE ROLE app_user LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS; END IF; END \$\$" -c "GRANT CONNECT, CREATE ON DATABASE $db TO app_user"
cd "$(dirname "$0")/../$project"
export DATABASE_URL="$base/$db" SITE_URL="${SITE_URL:-https://datlich.example.vn}"
npm run --silent verify
