---
type: llm
---

PASS if the answer proposes fixing the query pattern itself: a composite index that starts with tenant_id and matches the sort (for example (tenant_id, created_at)), created without locking the table (CREATE INDEX CONCURRENTLY), and keyset pagination or avoiding count(*)/OFFSET on large tables.
FAIL if index advice ignores tenant_id or the sort column.
