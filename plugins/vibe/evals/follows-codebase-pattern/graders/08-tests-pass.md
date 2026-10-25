---
type: llm
focus: trace
---

PASS if the trace ends with node --test passing, including new supplier tests written in the same node:test style as test/customer.service.test.js (resetDb in beforeEach) that cover creating, listing and the duplicate-name error.
FAIL if tests fail, are missing, or use a different test framework.
