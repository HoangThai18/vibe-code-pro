---
type: llm
focus: trace
---

PASS if results are put in Vietnamese alphabetical order without changing the collation used for matching: for example `ORDER BY full_name COLLATE utf8mb4_vi_0900_ai_ci`, an indexed generated column in `utf8mb4_vi_0900_ai_ci` used only for ordering, or sorting the page in the app with `Intl.Collator('vi')`.
FAIL if ordering is left as `ORDER BY full_name` on `utf8mb4_unicode_ci`/`utf8mb4_0900_ai_ci` with no Vietnamese ordering step, or if Vietnamese order is obtained by switching the matched column to the Vietnamese collation.
