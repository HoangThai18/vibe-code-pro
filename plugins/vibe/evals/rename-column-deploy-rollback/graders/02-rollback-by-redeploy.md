---
type: llm
---

PASS if the rollback plan relies on redeploying the previous version, which works because every migration stays backward compatible with the code that runs before and after it, and does not rely on running a down migration after new data has been written.
FAIL if rollback depends on reverting migrations that would lose data written in the meantime.
