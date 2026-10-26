---
type: llm
---

PASS if the answer rejects setInterval in the API process (with 3 instances it sends duplicates, and it stops on restart or deploy) and proposes a durable job queue or scheduler (for example pg-boss or another Postgres-backed queue, or BullMQ) with workers that run separately from request handling.
FAIL otherwise.
