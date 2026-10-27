---
type: llm
focus:
  source: file
  path: src/customers/search.ts
---

PASS if all three hold: the input is split into words and every word must match (so "thao nguyen" finds "Nguyễn Thị Thảo"); phone input is normalized (spaces, dots, dashes removed; +84 or 84 at the start turned into 0) before matching the stored `0912345678` form; and `%` and `_` typed by the user are escaped (or otherwise matched literally) in the LIKE pattern.
FAIL if any of the three is missing.
