# verify: the code behind the references

Every code block in the skills' references was run. This folder keeps that code and its tests, so a change to a reference can be checked again.

| Folder | Reference |
|---|---|
| `search`, `payments`, `notifications`, `realtime`, `data-import`, `jobs`, `app-security`, `privacy` | `vibe-backend/references/<same name>.md` |
| `i18n`, `seo` | `vibe-frontend/references/<same name>.md` |
| `ai` | `vibe-ai/references/integration.md`, `cost.md`, `testing.md` |
| `performance` | `vibe-ship/references/performance.md` (k6, Playwright, a 500,000-row dataset: run by hand) |
| `mobile` | `vibe-mobile/references/*` (Expo SDK 58, Jest, `eas.json` checks: run by hand) |
| `desktop` | `vibe-desktop/references/*` (Electron + Playwright, Tauri build: run by hand) |
| `tasks` | `vibe-tasks/scripts/tasks.py` (standard-library `unittest`; CI: `skills.yml` on Python 3.8 and 3.12) |

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
