#!/usr/bin/env bash
# verify/tools/run.sh spring: DATABASE_URL is an empty database and a superuser (postgres://user:pass@host:port/db)
set -euo pipefail
cd "$(dirname "$0")"
: "${DATABASE_URL:?run through verify/tools/run.sh spring}"
db="${DATABASE_URL##*/}"
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -v db="$db" -f db/bootstrap.sql

rest="${DATABASE_URL#*://}"; creds="${rest%%@*}"
export DB_URL="jdbc:postgresql://${rest#*@}"
export DB_ADMIN_USER="${creds%%:*}" DB_ADMIN_PASSWORD="${creds#*:}"   # tests only: reset data between tests
export DB_OWNER_USER=spring_owner DB_OWNER_PASSWORD=spring-owner-test
export DB_APP_USER=spring_app DB_APP_PASSWORD=spring-app-test DB_DEFINER_ROLE=spring_definer
export JWT_SECRET="test-only-secret-at-least-32-bytes-long!!"
# Flyway runs at startup of the first test context, as spring_owner, from the empty database
mvn -B -ntp test
