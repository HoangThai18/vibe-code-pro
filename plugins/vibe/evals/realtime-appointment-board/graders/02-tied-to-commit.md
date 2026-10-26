---
type: llm
---

PASS if events are emitted as part of the writing transaction, so they are delivered only after COMMIT (a trigger or pg_notify inside the transaction, or an outbox/job row written in the same transaction).
FAIL if the event is published to Redis, a socket or another connection before the transaction commits or independently of it.
