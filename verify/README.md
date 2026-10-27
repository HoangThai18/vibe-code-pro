# verify: the code behind the references

Every code block in the skills' references was run. This folder keeps that code and its tests, so a change to a reference can be checked again.

| Folder | Reference |
|---|---|
| `backend-core` | `vibe-backend/references/postgres-rls.md`, `multi-tenant.md`, `auth.md`, `native-auth.md`, `api-conventions.md`, `data-layer.md`, `isolation-tests.md` (vitest, Express 5) |
| `search`, `payments`, `notifications`, `realtime`, `data-import`, `jobs`, `app-security`, `privacy` | `vibe-backend/references/<same name>.md` |
| `laravel` | `vibe-backend/references/laravel.md` (Laravel 13, PHPUnit 12, MySQL 8.4/8.0, plus PostgreSQL 16 RLS; `verify.sh` runs `composer install`) |
| `dotnet` | `vibe-backend/references/dotnet.md` (ASP.NET Core 10, EF Core 10 + Npgsql 10, xUnit v3; needs the .NET 10 SDK, psql and pg_dump 16) |
| `spring` | `vibe-backend/references/spring.md` (Spring Boot 4.1, Java 21, Maven, PostgreSQL 16 RLS) |
| `mysql` | `vibe-backend/references/mysql.md` (node:test + mysql2 on MySQL 8.4 and 8.0; creates and drops its own database through `MYSQL_URL`) |
| `i18n`, `seo` | `vibe-frontend/references/<same name>.md` |
| `ai` | `vibe-ai/references/integration.md`, `cost.md`, `testing.md`, `chat-and-files.md` |
| `next-actions` | `vibe-frontend/references/server-actions.md` (`next build` + `next start`, posting to the actions over HTTP) |
| `performance` | `vibe-ship/references/performance.md` (k6, Playwright, a 500,000-row dataset: run by hand) |
| `mobile` | `vibe-mobile/references/app-data.md`, `testing.md`, `platform-features.md` (Expo SDK 58 + Jest + the push `devices` SQL: `cd verify/mobile/app && npm ci`, then `verify/tools/run.sh mobile`; by hand) |
| `desktop` | `vibe-desktop/references/security.md`, `testing.md`, `app-data.md` (`cd verify/desktop/electron-app && npm ci && xvfb-run -a npm run verify`; Tauri 2.12 built by hand) |
| `tasks` | `vibe-tasks/scripts/tasks.py` (standard-library `unittest`; CI: `skills.yml` on Python 3.8 and 3.12) |
| `eval-report` | `plugins/vibe/evals/report.py` and the report sample in both READMEs (standard-library `unittest`, same CI job) |

## Run

You need Node 22, `psql` and a PostgreSQL 16 superuser (the tests create roles and reset the schema of their own database):

```bash
cd verify/payments && npm ci && cd ../..
PG_URL=postgres://postgres:postgres@localhost:5432 verify/tools/run.sh payments
```

`run.sh` creates a fresh database `verify_<project>` and runs the project's `npm run verify` (typecheck and tests). CI runs every project listed in `.github/workflows/verify.yml`.

## Docs come from the tested code

A reference with a template (`<project>/<name>.tpl.md`) is rendered from it: a line that is exactly `{{path}}` is replaced by that file. Edit the code and the template, not the rendered doc:

```bash
python3 verify/tools/check_docs.py          # CI: fails if a doc no longer matches its template and code
python3 verify/tools/check_docs.py --write  # re-render after editing
```

`tools/docs.json` lists the templates. References without a template were checked by hand; their code here may differ from the doc in comments only.

Shared code (the canonical schema, `withTenant`/`withMember`, `authz.ts`, `secret-box.ts`, the formatting module) is kept as byte-identical copies in the projects that need it, listed in `tools/copies.json`. Edit the original, then `python3 verify/tools/check_copies.py --write`; CI fails if a copy drifts.
