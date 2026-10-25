---
type: llm
---

PASS if the plan handles constraints on the old column before code stops writing it: if customer_name is NOT NULL (or has other constraints), that is dropped or given a default first, otherwise inserts from the new code fail.
FAIL if the constraint question on the old column is never considered.
