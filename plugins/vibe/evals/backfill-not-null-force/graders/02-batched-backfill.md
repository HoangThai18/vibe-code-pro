---
type: llm
---

PASS if the backfill runs in batches (for example by id ranges or LIMIT with a loop, committing between batches) rather than one UPDATE over all 5 million rows.
FAIL if a single full-table UPDATE is proposed.
