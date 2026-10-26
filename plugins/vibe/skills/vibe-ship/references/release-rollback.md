# Release, feature flags and rollback

## Contents
1. Pre-release checklist
2. Deploy order with DB changes
3. Feature flags
4. Rollback
5. Hotfix
6. Versions, changelog, release notes

## 1. Pre-release checklist

Write it in `docs/releases/<version>.md` from `templates/RELEASE.md`:

- Phase/task review PASSED; CI green; E2E run on staging.
- Migrations tried on staging with near-real data volume; their run time and locks are known.
- Last backup succeeded (and a test restore has been done before).
- New features' flags default to off (if any).
- Dashboards and alerts for the new feature exist.
- Rollback plan written: which signals trigger rollback, who decides, the steps.
- On-call after release, incident channel, user notice for major changes or maintenance.

## 2. Deploy order with DB changes

Example: rename column `customer_name` (currently `NOT NULL`) to `full_name` with no moment of failure:

| Release | Migration | Code | Rollback to previous |
|---|---|---|---|
| R1 (expand) | Add column `full_name` (nullable) | Write **both** columns, still read the old one | OK: the old version ignores the new column |
| (job) | Backfill `full_name` from `customer_name` in batches, check remaining NULL rows = 0 | | No impact |
| R2 | Make `full_name` `NOT NULL` (safe method: the `vibe-backend` skill, `references/data-layer.md` section 7); **drop `NOT NULL` from `customer_name`** so the next version can stop writing it | Read `full_name`, still write both | OK to R1: R1 writes both columns |
| R3 | None | Stop writing and **remove `customer_name` from the ORM model** (Prisma schema, Rails `ignored_columns`...) so the ORM no longer selects or inserts it | OK to R2: the old column still exists, only missing data written while R3 ran; backfill it from `full_name` if needed |
| R4 (contract) | `DROP COLUMN customer_name`, once R3 is stable | No change | Only back to R3 (R3 no longer knows the old column); going back to R2 means re-adding the column |

Three common mistakes with this kind of change:
- Stopping writes to the old column while it is still `NOT NULL`: every insert fails the moment you deploy.
- Dropping the column while the running code (or a version you might roll back to) still maps it in the ORM: every query of that version fails.
- Merging several steps into one release to "save effort", which loses the ability to roll back.

Principle: each release contains only changes that **the previous code version can still run with**. Deleting data is always a separate, final step, once you are sure you won't go back.

## 3. Feature flags

- For risky or large features: code is deployed but off, then turned on when ready.
- Multi-tenant: enable per tenant (internal → a few friendly tenants → everyone). A bug hits only a small group.
- Start simple: a `feature_flags (key, tenant_id null = system-wide, enabled)` table with a short cache; use a dedicated service when you need A/B tests or multiple teams.
- Flags are tech debt: once the feature is stable, remove the flag and the old code path (create a cleanup task card as soon as it's at 100%).

## 4. Rollback

Pick the fastest, least risky option, in this order:

1. **Turn off the feature flag**: seconds, no deploy.
2. **Redeploy the previous artifact**: works if the new version's migrations are backward compatible (section 2), which is why every release must be. **Don't run migrations** on rollback: the DB stays at the new version and the old code runs on it; the old version's migration tool doesn't know the newer migrations and many tools will error (the sample deploy workflow has the input `run_migrations: false` for this, `references/ci-cd.md` section 4).
3. **Forward fix**: when rolling back code isn't enough, or migrations have already written data in the new shape. Small hotfix, quick review, deploy.
4. **Restore data from backup**: last resort; loses data created after the backup (unless you have PITR). Prefer restoring into a separate DB and copying the needed part over overwriting all of production (`references/backup-restore.md`).

On "down migrations": once the new version has written data, running a migration backwards usually loses that data. Don't treat down migrations as the main rollback plan; treat them as a dev-environment tool.

Decide rollback by criteria written in advance (e.g. error rate 3x normal for 10 minutes, or a failing payment flow), not by debate mid-incident.

## 5. Hotfix

- Create branch `hotfix/<description>` from the tag running in production.
- Minimal fix with a test that reproduces the bug (the `vibe-fix` skill); a quick review, but still a review.
- Deploy through the normal pipeline (no manual edits on the server), then merge back into `main` and any open phase branches.

## 6. Versions, changelog, release notes

- Version by semver (`v1.4.0`) or by date (`2026.10.25`); the git tag matches the artifact.
- Generate the changelog from commits (with task IDs) or PRs; write release notes for users: what changed, what it affects, whether they need to do anything.
