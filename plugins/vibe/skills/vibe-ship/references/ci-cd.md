# CI/CD and environments

## Contents
1. Environments
2. Config and secrets
3. CI on every pull request
4. CD: staging and production
5. Migrations in the pipeline

## 1. Environments

| Environment | Purpose | Data |
|---|---|---|
| Local | development | fake seed |
| Preview (per PR, if the platform supports it) | quick look at changes | fake seed |
| Staging | pre-release testing, E2E, migration rehearsal | same structure as production, fake or anonymized data |
| Production | real users | real data |

The closer staging is to production (same DB version, same config, same deploy method), the fewer surprises at go-live.

## 2. Config and secrets

- Read config from env vars and validate it at startup (a missing var stops the app with a clear error instead of running half-configured).
- `.env.example` lists every var with fake values; real `.env*` files are in `.gitignore`.
- Production secrets live in the platform's secret manager or GitHub Environments; each environment has its own keys.
- A committed secret counts as leaked: revoke it and issue a new key immediately; removing it from history is secondary.

## 3. CI on every pull request

Goal: a PR can't merge if lint, typecheck, tests or build fail. GitHub Actions example for Node + pnpm + Postgres (check the latest versions of the actions and Node before use):

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:16               # same major version as production
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: app_test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      # Roles as in production: migrations run as the owner, tests as the app role
      # (not superuser); otherwise RLS is bypassed and tests pass falsely.
      ADMIN_DATABASE_URL: postgres://postgres:postgres@localhost:5432/app_test
      MIGRATION_DATABASE_URL: postgres://app_owner:app_owner@localhost:5432/app_test
      DATABASE_URL: postgres://app_user:app_user@localhost:5432/app_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4        # reads the pnpm version from "packageManager" in package.json
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/ci-roles.sql
      - run: pnpm db:migrate
        env:
          DATABASE_URL: ${{ env.MIGRATION_DATABASE_URL }}   # the migrate tool reads DATABASE_URL
      - run: pnpm test
      - run: pnpm build
```

`db/ci-roles.sql` creates the roles for CI's throwaway DB (the `app_user` part comes from the `vibe-backend` skill, `references/postgres-rls.md` section 1):

```sql
CREATE ROLE app_owner LOGIN PASSWORD 'app_owner';
-- when app_owner owns the DB, it can create tables in schema public (Postgres 15+)
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I OWNER TO app_owner', current_database()); END $$;
-- next: the whole role block from postgres-rls.md section 1, with app_user's password set to 'app_user'
-- (that block has ALTER DEFAULT PRIVILEGES FOR ROLE app_owner, so tables created by migrations are granted to app_user automatically)
```

- Enable branch protection on `main`: require passing CI and a review before merge.
- E2E (Playwright): a separate workflow with sharding and merged reports; template in the `vibe-build` skill (`references/e2e-playwright.md` section 13). Run it on every PR if the E2E suite is fast; otherwise nightly and before release.
- Add light security scanning: dependency audit, GitHub secret scanning.

## 4. CD: staging and production

- Merge into `main` → build an artifact (Docker image or build) tagged with the commit SHA → migrations → automatic deploy to staging → smoke test.
- Production: deploy **the same artifact** that ran on staging, triggered manually (or by tag) through a GitHub Environment with required reviewers.
- Zero-downtime deploy: rolling or blue-green depending on the platform; the app has a readiness check (healthcheck section in `references/observability.md`) so it gets traffic only when ready.
- After deploy: automatic smoke test (healthcheck + 1–2 key requests), watch the dashboard for 15–30 minutes.

Workflow skeleton (passes actionlint). `scripts/migrate.sh` and `scripts/deploy.sh` are platform-specific; write them from the platform's current docs (e.g. `docker run --rm -e DATABASE_URL "$1" pnpm db:migrate` for migrate):

```yaml
# .github/workflows/deploy.yml
name: deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      image_tag:
        description: "Commit SHA của image đã chạy ổn trên staging (rollback: SHA của bản trước)"
        required: true
      run_migrations:
        description: "Chạy migration trước khi deploy. Rollback code thì bỏ chọn: DB đã ở version mới hơn image cũ"
        type: boolean
        default: true

permissions:
  contents: read

jobs:
  build:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write                    # only this job pushes the image
    steps:
      - uses: actions/checkout@v4
      - name: Tên image (registry chỉ nhận chữ thường)
        run: echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ env.IMAGE }}:${{ github.sha }}

  staging:
    needs: build
    runs-on: ubuntu-latest
    environment: staging
    concurrency: deploy-staging
    steps:
      - uses: actions/checkout@v4
      - run: echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"
      - name: Migration bằng role owner, một lần, trước khi code mới nhận traffic
        run: ./scripts/migrate.sh "$IMAGE:$GITHUB_SHA"
        env:
          DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}
      - name: Deploy
        run: ./scripts/deploy.sh staging "$IMAGE:$GITHUB_SHA"
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
      - name: Smoke test
        run: curl --fail --silent --retry 10 --retry-delay 6 --retry-all-errors "$APP_URL/health/ready"
        env:
          APP_URL: ${{ vars.APP_URL }}

  production:
    if: github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    environment: production             # enable "Required reviewers" for this environment
    concurrency: deploy-production
    env:
      TAG: ${{ inputs.image_tag }}       # via env, never interpolated into the shell command
    steps:
      - name: Kiểm tag là commit SHA
        run: '[[ "$TAG" =~ ^[0-9a-f]{40}$ ]] || { echo "image_tag phải là SHA 40 ký tự"; exit 1; }'
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.image_tag }}  # migrate/deploy scripts at the same version as the image
      - run: echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"
      - if: ${{ inputs.run_migrations }}
        run: ./scripts/migrate.sh "$IMAGE:$TAG"
        env:
          DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}
      - run: ./scripts/deploy.sh production "$IMAGE:$TAG"
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
      - run: curl --fail --silent --retry 10 --retry-delay 6 --retry-all-errors "$APP_URL/health/ready"
        env:
          APP_URL: ${{ vars.APP_URL }}
```

- If the platform has a step that runs before deploy (e.g. release command, pre-deploy command), run migrations there instead of from the GitHub runner; runners usually aren't allowed to connect directly to the production DB.
- `concurrency` keeps two deploys to the same environment from overlapping. The `image_tag` input goes through an env var and is format-checked, never interpolated into a shell command.
- Only the build job gets `packages: write`; deploy jobs are read-only. The image name is lowercased because registries reject uppercase (`github.repository` keeps the account name's uppercase).
- Rolling back code = rerun the production job with the previous version's SHA and **uncheck `run_migrations`** (the old artifact is still in the registry; the DB stays at the newer version). Details: `references/release-rollback.md` section 4.
- The smoke test calls `/health/ready` (readiness, `references/observability.md`).

## 5. Migrations in the pipeline

- Migrations are a separate step **before** the new code gets traffic, run with a DDL-capable role, once (not by every instance at startup).
- Migrations must be compatible with the running code (expand → contract), so neither deploy nor rollback breaks.
- Long migrations (large backfills, indexes on large tables) go in a separate job with progress tracking; don't make the deploy pipeline wait for hours.
- A migration fails midway: the pipeline stops and the new code is not deployed.
