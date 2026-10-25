---
type: llm
---

PASS if tenant and user context are read with current_setting(..., true) and protected so an empty string does not break the uuid cast (for example NULLIF(..., '')), so a missing context yields no rows rather than an error or all rows.
FAIL if current_setting is cast directly to uuid or a missing context could return every row.
