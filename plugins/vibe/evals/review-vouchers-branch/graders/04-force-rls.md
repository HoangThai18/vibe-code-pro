---
type: llm
---

PASS if the review reports that the vouchers migration enables RLS but omits `ALTER TABLE vouchers FORCE ROW LEVEL SECURITY`, unlike the other tenant tables, so the table owner bypasses the policy.
FAIL if this is not reported.
