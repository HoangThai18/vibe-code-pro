---
type: llm
focus: trace
---

PASS if phone input is normalized before matching: spaces, dots and dashes removed, and +84 or 84 at the start turned into 0, so '0912 345 678' and '+84 912 345 678' find a customer stored as '0912345678'.
FAIL if the phone input is matched as typed.
