---
type: llm
---

PASS if there is a per-tenant unique key on the normalized phone (for example UNIQUE (tenant_id, phone)) and rows are written with an upsert (INSERT ... ON CONFLICT or equivalent), so importing the same file again creates no duplicates.
FAIL if it uses a plain INSERT, a unique key that ignores the tenant, or deduplicates only in application memory.
