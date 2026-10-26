---
type: llm
---

PASS if the answer says to measure before adding Redis and names concrete tools: pg_stat_statements and/or EXPLAIN (ANALYZE, BUFFERS) on the actual query, and/or tracing per route to see where the time goes.
FAIL if it recommends adding the cache first without measuring.
