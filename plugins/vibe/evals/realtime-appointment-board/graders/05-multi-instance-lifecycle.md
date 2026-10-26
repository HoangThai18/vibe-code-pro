---
type: llm
---

PASS if, with 3 API instances, fan-out uses one dedicated LISTEN connection per instance (not a pooled connection, not PgBouncer transaction mode) or a shared broker, the listener reconnects after a drop, and open streams are cleaned up on close and ended when the user is removed from the spa or logs out.
FAIL if instance fan-out is not addressed, or a removed user's stream keeps receiving events.
