---
type: llm
---

PASS if the column is not renamed in a single release; the change is spread over several releases: add full_name, write both columns, backfill, switch reads, stop writing customer_name, and drop customer_name only at the end.
FAIL if it uses ALTER TABLE ... RENAME COLUMN while old instances still run, or compresses everything into one deploy.
