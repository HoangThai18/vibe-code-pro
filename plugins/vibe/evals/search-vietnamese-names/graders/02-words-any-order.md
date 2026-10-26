---
type: llm
focus: trace
---

PASS if the search splits the input into words and requires every word to match (in any order), so 'thao nguyen' also finds 'Nguyễn Thị Thảo'.
FAIL if the whole input is matched as one substring.
