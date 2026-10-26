# Release vX.Y.Z

_Planned: YYYY-MM-DD HH:mm · Owner: ... · On call after release: ..._

## Scope
- Tasks/phase: ...
- DB changes: none / yes (list migrations, run time on staging)
- Feature flags: flag name, default, rollout plan (internal → pilot tenants → everyone)

## Pre-release checklist
- [ ] Review PASS (docs/reviews/...)
- [ ] CI green, E2E run on staging
- [ ] Migrations tried on staging, backward compatible with the running version
- [ ] Last successful backup at: ...
- [ ] Dashboard and alerts for this change in place
- [ ] Users notified (if major changes or maintenance)

## Rollback plan
- Rollback signals: e.g. error rate 3x normal for 10 minutes, payment flow failing
- Decided by: ...
- Option 1: turn off flag ...
- Option 2: redeploy artifact vA.B.C (commit ...)
- Data: are the migrations compatible with rolling back code? If not, what is the forward-fix plan?

## After release
- [ ] Smoke test passed
- [ ] Dashboard watched for 30 minutes: stable / issues (note them)
- [ ] Release note sent to users
