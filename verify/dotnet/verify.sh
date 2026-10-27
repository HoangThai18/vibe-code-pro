#!/usr/bin/env bash
# ASP.NET Core + EF Core + Npgsql: build, migrate an empty database as the table owner, run the tests as app_user.
#   PG_URL=postgres://user:pass@localhost:5432 verify/tools/run.sh dotnet   (DATABASE_URL: a superuser, fresh verify_dotnet)
set -euo pipefail
cd "$(dirname "$0")"
: "${DATABASE_URL:?DATABASE_URL (a superuser) is required: verify/tools/run.sh dotnet}"
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 TESTINGPLATFORM_TELEMETRY_OPTOUT=1

echo "== build (packages from the lock files)"
dotnet tool restore
dotnet restore tests/Spa.Api.Tests --locked-mode
dotnet build tests/Spa.Api.Tests --no-restore --configuration Release -warnaserror

echo "== migrations"
./migrate.sh

echo "== tests (xUnit v3 on Microsoft.Testing.Platform)"
dotnet test --project tests/Spa.Api.Tests --no-build --configuration Release
