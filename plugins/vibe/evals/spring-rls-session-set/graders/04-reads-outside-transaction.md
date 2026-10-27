---
type: llm
---

PASS if the answer finds that `CustomerController.search` and `AppointmentController.day` call repository query methods directly, outside any transaction (Spring Data gives declared query methods no transaction, unlike `findAll`/`findById`), and moves these reads into `@Transactional(readOnly = true)` service methods (or otherwise runs them in a transaction that sets the tenant), noting that after the fix they would otherwise return no rows.
FAIL if these two reads are left outside a transaction, or the answer does not mention them.
