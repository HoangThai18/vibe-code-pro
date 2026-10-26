---
type: llm
---

PASS if the proposed query for "today's appointments" is bounded by local midnights in the branch's time zone (for example SQL with AT TIME ZONE on the bounds, keeping a range on starts_at), and there is a test on both sides of local midnight (for Vietnam 16:59:59Z and 17:00:00Z). Mentioning starts_at::date or CURRENT_DATE as the cause of the bug is fine.
FAIL if the proposed fix itself still compares starts_at::date with current_date or uses the server's local date, or there is no test around midnight.
