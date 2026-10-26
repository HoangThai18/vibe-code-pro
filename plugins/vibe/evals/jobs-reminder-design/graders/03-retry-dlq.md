---
type: llm
---

PASS if the answer covers retries with backoff and a limit, plus a dead letter queue (or failed state) that someone is alerted about.
FAIL if either retry-with-limit or dead letter/alerting is missing.
