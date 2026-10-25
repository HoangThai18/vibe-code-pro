---
type: llm
---

PASS if the plan explains that with FORCE ROW LEVEL SECURITY a backfill run as the table owner without tenant context would update zero rows (or fail), handles it with a dedicated BYPASSRLS maintenance role or by setting the tenant context per tenant, and verifies the affected row count before moving on.
FAIL if the RLS/FORCE interaction is not addressed.
