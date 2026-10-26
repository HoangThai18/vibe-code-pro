# Postmortem: Incident name

_Date: YYYY-MM-DD · Severity: critical / high / medium · Author: ..._

The goal is to improve the system and the process, not to find someone to blame.

## Summary
2–3 sentences: what happened, who was affected, how it was resolved.

## Impact
- Duration: from HH:mm to HH:mm (total ... minutes)
- Affected tenants / users: ...
- Features: ...
- Data: unaffected / corrupted / exposed (details)

## Timeline
| Time | Event |
|---|---|
| HH:mm | Deploy vX.Y.Z |
| HH:mm | Alert / customer reports error |
| HH:mm | Rollback / flag disabled |
| HH:mm | System stable |

## Root cause
Why the failure happened, and why the safeguards (tests, review, staging, alerts) didn't catch it earlier.

## What helped / what hindered
- Helped: ...
- Hindered: ...

## Preventive actions
| Action | Owner | Task card | Due |
|---|---|---|---|
