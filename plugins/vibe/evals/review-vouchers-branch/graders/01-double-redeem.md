---
type: llm
---

PASS if the review reports that two concurrent redeem requests for the same code can both succeed, because the route reads redeemed_at and then runs an UPDATE that does not re-check it, and proposes a fix such as `UPDATE ... SET redeemed_at = now() WHERE ... AND redeemed_at IS NULL RETURNING ...` (treating zero rows as already redeemed) or locking the row with SELECT ... FOR UPDATE.
FAIL if the race is not reported.
