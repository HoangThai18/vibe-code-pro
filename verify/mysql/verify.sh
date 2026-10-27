#!/usr/bin/env bash
# verify/tools/run.sh mysql — MYSQL_URL: a user that may create databases and users; VERIFY_DB: the database
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm ci --no-audit --no-fund
npx tsc -p .
export VERIFY_DB="${VERIFY_DB:-verify_mysql}"
node --import tsx scripts/db.ts create
trap 'node --import tsx scripts/db.ts drop' EXIT
npm run --silent migrate
npm test
