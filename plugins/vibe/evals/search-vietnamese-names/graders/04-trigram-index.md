---
type: llm
focus: trace
---

PASS if a migration creates a trigram index (pg_trgm, GIN or GiST) on the same normalized expression the query uses (optionally combined with tenant_id via btree_gin), with CREATE INDEX CONCURRENTLY or a note that it must run outside a transaction on the large table.
FAIL if there is no trigram index, or the index expression differs from what the query filters on.
