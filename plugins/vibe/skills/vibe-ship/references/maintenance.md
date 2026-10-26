# Recurring maintenance

Software rarely breaks from one big deploy; it breaks from small things neglected for a long time: outdated libraries with vulnerabilities, expired certificates, full disks, junk data piling up.

## Contents
1. Dependencies
2. Security patches
3. Runtime and infrastructure
4. Data
5. Cost
6. Schedule

## 1. Dependencies

- Enable Renovate or Dependabot: group patch/minor updates into a weekly PR; CI runs automatically.
- Upgrade majors one package at a time: read the migration guide first (the `vibe-plan` skill, `references/tech-research.md`), make it a task card with tests.
- Always commit the lockfile; CI installs in frozen mode (`pnpm install --frozen-lockfile`, `npm ci`).
- Unmaintained packages: plan a replacement before they cause an incident.

## 2. Security patches

- Scan for vulnerabilities in CI (`pnpm audit`, `npm audit`, `pip-audit`, OSV-Scanner) and enable GitHub security alerts.
- Prioritize by severity and by whether the vulnerability actually reaches your code; patch critical ones in code you use the same day via the hotfix process.
- Review access regularly: who has production access, which API keys are still used; rotate important secrets on a schedule and immediately when someone leaves the team.

## 3. Runtime and infrastructure

- Track end-of-life (EOL) dates for Node/Python, Postgres and OS images; upgrade before EOL, on staging first.
- Postgres: plan major upgrades (test a restore and run the tests on the new version); watch bloat and autovacuum on large tables.
- SSL certificates, domains: auto-renew, with an alert before expiry.

## 4. Data

- Retention policy for logs, audit records, sessions, temp files, and data of cancelled tenants. Cleanup jobs run in batches, bounded, with logs.
- Tenant deletion on request: a confirmed process; export the customer's data first if needed; delete DB rows, files, cache and copies in search/analytics; state how long data remains in backups.
- Track storage growth per table and per tenant.

## 5. Cost

Review the infrastructure bill monthly: oversized DBs, logs kept too long, buckets without lifecycle rules, forgotten preview environments. Attribute cost to tenants where possible to see which customers lose money.

## 6. Schedule

| Frequency | Tasks |
|---|---|
| Weekly | Merge dependency update PRs, check new errors in error tracking, check security alerts |
| Monthly | Restore drill, review ignored or noisy alerts, review cost, check DB size |
| Quarterly | Necessary major upgrades, review access and secrets, check EOL dates, review runbooks |

Each recurring job is a repeating task card or a reminder in the team calendar.
