#!/usr/bin/env bash
# verify/tools/run.sh laravel → this script, with MYSQL_URL (a user that may create databases), VERIFY_DB and,
# unless PG_URL=none, DATABASE_URL (a fresh PostgreSQL database, superuser) for the PostgreSQL + RLS tests.
# Installs, migrates empty databases, runs every test, drops the MySQL database.
set -euo pipefail
cd "$(dirname "$0")"
export VERIFY_DB="${VERIFY_DB:-verify_laravel}" MYSQL_URL="${MYSQL_URL:-mysql://root:root@127.0.0.1:3306}"
export COMPOSER_PROCESS_TIMEOUT=0
composer install --no-interaction --prefer-dist --no-progress --quiet
php scripts/database.php create
trap 'php scripts/database.php drop' EXIT
export DB_CONNECTION=mysql DB_URL="$MYSQL_URL/$VERIFY_DB"
php artisan migrate --force --no-interaction
if [ -n "${DATABASE_URL:-}" ]; then
  # Owner (here the superuser) runs migrations; the app logs in the same way and switches to app_user
  export PG_OWNER_URL="$DATABASE_URL" PG_APP_URL="$DATABASE_URL" PG_APP_ROLE=app_user
  php artisan migrate --database=pgsql --path=database/migrations-pgsql --force --no-interaction
fi
vendor/bin/phpunit "$@"
