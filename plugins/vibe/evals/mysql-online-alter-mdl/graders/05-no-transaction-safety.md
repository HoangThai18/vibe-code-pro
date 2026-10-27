---
type: llm
focus: trace
---

PASS if the answer does not rely on the runner's BEGIN/ROLLBACK to undo a failed DDL migration: it notes that MySQL commits each DDL statement (so a failed multi-statement file leaves the earlier statements applied), and puts each ALTER in its own migration or makes the steps safe to rerun.
FAIL if it presents the transaction in `scripts/migrate.ts` as making the migration all-or-nothing, or puts both ALTERs in one file without addressing a failure between them.
