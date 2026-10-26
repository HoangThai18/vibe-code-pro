---
type: llm
---

PASS if the answer proposes a load test (k6 or similar) with an explicit target (for example p95 latency threshold at a request rate), run against staging with production-like data volume, comparing before and after the fix.
FAIL if there is no load test or no measurable target.
