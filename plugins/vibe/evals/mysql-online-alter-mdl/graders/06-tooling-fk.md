---
type: llm
focus: trace
---

PASS if the plan uses MySQL's online DDL (INSTANT for the column, INPLACE with LOCK=NONE for the index) without requiring an external tool, or, if it recommends gh-ost or pt-online-schema-change, it accounts for the foreign keys on `appointments` (gh-ost does not support foreign keys; pt-online-schema-change needs `--alter-foreign-keys-method`).
FAIL if it recommends gh-ost for this table without mentioning the foreign keys, or uses ALGORITHM=COPY or a plain ALTER with no ALGORITHM/LOCK clause.
