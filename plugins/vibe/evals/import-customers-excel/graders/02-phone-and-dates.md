---
type: llm
---

PASS if phones are normalized in code (a numeric cell 912345678 becomes 0912345678, and +84/84 prefixes become 0) and dates written dd/mm/yyyy are parsed day-first by explicit code, with Excel date cells or serial numbers handled.
FAIL if phones stay as numbers or as typed, or text dates go through new Date(string) or Date.parse.
