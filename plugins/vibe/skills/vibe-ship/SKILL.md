---
name: vibe-ship
description: "Ships to production and keeps it running: CI/CD (GitHub Actions), environments, deploys with migrations, feature flags, releases, rollback; logs, metrics, alerts, error tracking, backup and restore drills, dependency upgrades and security patches, performance (slow pages or queries, load tests, Web Vitals, caching). Use for deploy, go-live, monitoring, backup, restore or slowness questions. Also use for Vietnamese requests like 'triển khai', 'lên production', 'sao lưu', 'khôi phục dữ liệu', 'nâng cấp thư viện', 'vá lỗ hổng', 'load lâu', 'thêm Redis'."
---

# Ship: go to production and keep it running

Read only what the job needs:

| Task | Read |
|---|---|
| CI/CD pipeline, environments, secrets | `references/ci-cd.md` |
| Release prep, deploy order with migrations, feature flags, rollback | `references/release-rollback.md` + `templates/RELEASE.md` |
| Logs, metrics, alerts, error tracking, healthchecks | `references/observability.md` |
| Backup, restore, restore drills, per-tenant data export | `references/backup-restore.md` |
| Dependency upgrades, security patches, data cleanup, recurring work | `references/maintenance.md` |
| Performance: targets, slow queries, k6 load tests, Core Web Vitals | `references/performance.md` |
| Secret and dependency vulnerability scanning in CI | the `vibe-backend` skill (`references/app-security.md` section 6) |
| Mobile app release: build, signing, stores, OTA, staged rollout, forced update | the `vibe-mobile` skill (`references/release.md`) |
| Desktop app release: packaging, code signing, notarization, auto-update | the `vibe-desktop` skill (`references/release.md`) |

Deploy platforms (Vercel, Fly, Railway, Render, AWS, GCP, VPS + Docker...) change their config often: read the current docs of the project's platform (the `vibe-plan` skill, `references/tech-research.md`) before writing config.

**Scale to fit.** An experimental project, or one without real users, doesn't need the full set: CI running tests, a working deploy and the managed DB's automatic backups are enough until go-live. A single question (e.g. "write a workflow that runs tests") gets exactly that, nothing unrequested. Anything touching production (deploy, migration, rollback, restore) still needs the user's approval first.

## Always-on rules

1. **No secrets in the repo.** Secrets live in a secret manager or the platform's env vars; the repo has only `.env.example`.
2. **Every deploy is an immutable artifact** (versioned image or build, tagged with the commit SHA). Rolling back code means redeploying the old artifact, not rebuilding from source. Installed mobile and desktop apps **can't be rolled back**: release gradually, disable via a server-side feature flag, fix with a newer version.
3. **Migrations stay backward compatible with the running code** (expand → contract), so rolling back code always works. Split breaking changes across several releases.
4. **Have a rollback plan before deploying**, written in `RELEASE.md`: rollback criteria, who decides, how.
5. **Risky features go behind a feature flag**, enabled gradually (internal → a few pilot tenants → everyone). Turning the flag off is the fastest rollback.
6. **A backup is worth something only after a test restore succeeds.**
7. **Alert on symptoms users see** (rising errors, slowness), with handling instructions; don't alert on everything.
8. **Production holds real data**: never run writes, migrations or cleanup scripts on production without the user's confirmation and a recent backup.
9. **Production secrets stay out of the agent session**: never ask for or accept production keys or service-role keys in chat; keep the production `DATABASE_URL` out of any local `.env` the agent can run commands against (use staging or a read-only role); never print `.env` files or secret values (`cat .env`, `printenv`, `echo $SECRET`). A secret pasted into chat counts as leaked: rotate it.

## Suggested order for a new project

P0: CI on every PR + automatic deploy to staging + healthcheck + error tracking + automatic DB backups. Before real users: basic alerts, one restore drill, a release checklist, a rollback plan. After go-live: recurring maintenance per `references/maintenance.md`.
