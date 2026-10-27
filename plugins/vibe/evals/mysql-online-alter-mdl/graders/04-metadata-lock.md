---
type: llm
focus: trace
---

PASS if the answer handles the metadata lock: it explains that the ALTER (INSTANT included) waits for open transactions on `appointments` and that every new query on the table then queues behind the waiting ALTER; it sets a short `lock_wait_timeout` for the migration session (in the migration, the runner, or the run steps), checks for long-running transactions first (for example `information_schema.innodb_trx`, the processlist, `sys.schema_table_lock_waits` or `performance_schema.metadata_locks`), and keeps the run away from the 02:00 export transaction or says to retry after error 1205.
FAIL if it says INSTANT or LOCK=NONE needs no lock and can run any time, or leaves `lock_wait_timeout` at its default.
