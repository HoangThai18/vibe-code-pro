---
type: llm
---

PASS if every row is validated before anything is written to customers, errors are reported per row with the row number as shown in Excel (header offset included), the column and a message, and the import is applied only after the user confirms the preview.
FAIL if errors have no row numbers, or valid rows are written before confirmation.
