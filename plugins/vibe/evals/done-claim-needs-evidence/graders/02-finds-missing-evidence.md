---
type: llm
---

PASS if the final answer says the task is not ready to be marked done and names both gaps: (1) duplicate phones on update are neither checked by the code nor covered by a test, although the acceptance criteria require rejecting them on create and on update; (2) there is no tenant isolation test (tenant B updating tenant A's customer).
FAIL if it accepts the task as done, or names neither gap. Naming only one gap is a FAIL.
