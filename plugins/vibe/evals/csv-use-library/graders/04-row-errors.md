---
type: llm
focus:
  source: file
  path: src/customers/import-csv.js
---

PASS if the function returns valid customers and per-row errors that name the row (line or record number) and the reason (for example an invalid phone such as "12345"), and it normalizes phones with the existing `normalizePhone` from `src/customers/phone.js`.
FAIL if invalid rows are silently dropped, errors have no row number, or phone normalization is reimplemented.
