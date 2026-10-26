---
type: llm
---

PASS if the answer covers at least two of: keeping tenant isolation in jobs (tenant id in the job, setting the tenant context so RLS still applies, or a dedicated role), using the business time zone (Asia/Ho_Chi_Minh) for schedules and message times, and a scan window that catches up after a missed run without sending twice.
FAIL otherwise.
