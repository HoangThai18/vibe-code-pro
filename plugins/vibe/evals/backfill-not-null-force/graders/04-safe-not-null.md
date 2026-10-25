---
type: llm
---

PASS if NOT NULL is enforced without a long exclusive lock, for example CHECK (phone_normalized IS NOT NULL) NOT VALID, then VALIDATE CONSTRAINT, then SET NOT NULL, and/or a lock_timeout is set for the DDL.
FAIL if it runs ALTER COLUMN ... SET NOT NULL directly on the large table without any of these.
