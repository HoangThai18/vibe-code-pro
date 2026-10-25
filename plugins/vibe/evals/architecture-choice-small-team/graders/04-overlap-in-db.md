---
type: llm
---

PASS if the response says the "no double-booking of a staff member" rule must be enforced by the database (for example a PostgreSQL exclusion constraint, a unique constraint on slots, or a row lock in the same transaction), not only by an application-level check, because concurrent requests can both pass a check-then-insert.
FAIL if the overlap rule is only checked in application code, or not addressed.
