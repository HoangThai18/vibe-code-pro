---
type: llm
focus: trace
---

PASS if the final name matching is accent-insensitive in a way that also maps đ/Đ to d: comparing in `utf8mb4_0900_ai_ci` (the column converted, a generated or extra search column in that collation, or `COLLATE utf8mb4_0900_ai_ci` in the query), or comparing an accent-free key that the code builds with an explicit đ → d mapping. The answer must not leave matching on `utf8mb4_unicode_ci` or `utf8mb4_general_ci` (where Đ ≠ D, so "dang" misses "Đặng").
FAIL if matching stays on the existing `utf8mb4_unicode_ci` column as is, or uses `utf8mb4_vi_0900_ai_ci` for the comparison.
