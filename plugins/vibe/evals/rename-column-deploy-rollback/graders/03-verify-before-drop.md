---
type: llm
---

PASS if the plan backfills in batches and verifies row counts or data consistency between the two columns before the old column is dropped.
FAIL if the drop happens without a verification step.
