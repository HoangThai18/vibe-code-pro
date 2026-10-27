---
type: llm
focus: trace
---

PASS if, by the end of the run, `customerService.update` stores the phone through `normalizePhone` and the last `node --test` run in the trace passes with no failing test.
FAIL if update still stores the raw phone, tests were not run after the change, or the last run has failures.
