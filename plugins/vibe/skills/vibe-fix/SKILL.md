---
name: vibe-fix
description: "Fix bugs and production incidents methodically: failing test first, root cause, minimal fix, prevention; incidents: limit damage first, then a postmortem. Use whenever code gives wrong results, a test fails, the user reports a bug, pastes a stack trace or log, or mentions errors, 500s, wrong data, outages, hotfixes or incidents. Also use for Vietnamese requests like 'đang ra X, đúng ra phải là Y', 'sửa giúp', 'lỗi 500', 'không chạy', 'dữ liệu sai', 'sập', 'sự cố', 'production có vấn đề'."
---

# Fix: bugs and incidents

The most common bug-fixing mistake is guess-and-patch: change several things at once, stop when the error disappears, never know which change was the cause. The bug comes back, or a new one appears. The process below costs a few minutes more and is far more reliable.

**Right-size it.** An obvious error with a clear cause (typo, wrong import, type error, an error message pointing straight at the bad line): fix it and run the related tests; skip the full process. The full process is for unclear causes, recurring bugs, and bugs touching data, money or security.

## Ordinary bugs (not a production incident)

1. **Pin down the symptom**: expected vs actual, environment, version/commit, tenant and user, time, `requestId` if any. Missing key information: ask the user once, all questions together.
2. **Reproduce with a test**: write the smallest test that exposes the bug and run it to see it **fail for the right reason**. Can't reproduce? Don't fix yet; gather more data (logs by `requestId`, the failing record's data, the user's steps).
3. **Isolate the root cause**:
   - Read the error message and stack trace down to the project's own code line. Browser-only bugs (blank page, failed requests, slowness): read the console, network and performance trace, via the Chrome DevTools MCP server if the project has it (the `vibe-plan` skill, `references/dev-tools.md` section 5).
   - Mobile and desktop apps: read crash reports (stack traces symbolicated with source maps, dSYM, mapping files), filtered by app version and OS; reproduce on that exact version (the `vibe-mobile` and `vibe-desktop` skills, `references/release.md`).
   - Check recent changes: `git log` of the related files, the latest deploy. A bug that appeared between two versions: `git bisect` with the test you just wrote.
   - List hypotheses and test **one at a time** with evidence (logs, queries, debugger, temporary logging). Change one thing at a time.
   - Keep asking "why" until you reach the real cause (missing constraint, wrong assumption about data, race condition), not the symptom.
4. **Fix minimally**, at the cause. The reproducing test now passes; all other tests still pass.
5. **Look for the same bug elsewhere** (grep for the pattern). Fix it too if small; if large, create a task card.
6. **Prevent recurrence**: the test is in place; add a DB constraint, validation, an alert, or a note in `AGENTS.md` if the bug came from a misunderstood convention.
7. **Record** in the commit or task card: symptom, root cause, fix. Bugs touching auth, tenant data, money or migrations go through the `vibe-review` skill before merging.

**Stop rule**: after 2 failed fix attempts on the same failure, stop. Go back to the last green commit (`git restore`, or `git revert` for committed attempts), list your hypotheses with the evidence for and against each, and ask the user before trying again.

Never: disable a failing test, catch and ignore errors to silence them, change many places at once "to be safe", close a bug with "works on my machine". Flaky (intermittent) tests: the `vibe-build` skill (`references/testing.md`); slowness without an error: the `vibe-ship` skill (`references/performance.md`).

## Production incidents

Priority: **limit damage → communicate → find the cause → fix → learn**.

1. **Assess severity**: how many users or tenants are affected, which features (payments and data outrank UI), whether data is corrupted or exposed.
2. **Limit damage before finding the cause**: disable the feature flag, redeploy the previous version (the `vibe-ship` skill, `references/release-rollback.md`), temporarily disable the feature or the tenant causing load, add resources if overloaded. Ask the user before any write operation on production.
3. **Communicate**: owners and affected customers know there is an incident and it's being handled; update them regularly.
4. **Investigate and fix** with the bug process above. Hotfix: branch from the running tag, reproducing test, quick review, deploy through the pipeline, merge back into `main`.
5. **Corrupted data**: stop the source, determine the scope (tables, tenants, time window), fix with a reviewed script that checks row counts, or partially restore from backup (the `vibe-ship` skill, `references/backup-restore.md`).
6. **Postmortem** within 48 hours using `templates/POSTMORTEM.md`, blameless: timeline, impact, root cause, what helped and what hindered, preventive actions (each a task card with an owner).

## Suspected data leak between customers

A personal data leak may require notifying the competent authority within 72 hours of discovery: record the discovery time from the start and inform the decision-maker (the `vibe-backend` skill, `references/privacy.md` section 7).

Treat it as the most severe incident: close the leak immediately (disable the feature, block the endpoint), preserve logs as evidence, identify affected tenants and data, inform the owner and the legal team. Vietnam's personal data protection rules set breach notification duties and deadlines; ask legal to get them right.
