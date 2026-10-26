---
type: llm
---

PASS if applying 20,000 rows runs in a background job in chunks, each chunk committed with its progress (or otherwise resumable), so a crash or retry does not duplicate or skip rows, and the job sets the tenant context from its payload (withTenant / app.tenant_id).
FAIL if a retry can re-insert rows, or the job writes without tenant context.
