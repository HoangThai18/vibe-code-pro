---
type: llm
---

PASS if INSERT, UPDATE and DELETE on memberships are restricted to the current tenant only (tenant_id equals the current tenant), with WITH CHECK on inserts and updates.
FAIL if writes are allowed based on the user's own membership rows or have no WITH CHECK.
