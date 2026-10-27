---
type: llm
---

PASS if the review asks for tests the branch lacks: at least a tenant isolation test for the voucher routes (tenant A cannot redeem or see tenant B's voucher, like test/appointments.test.js) and a concurrent redeem test.
FAIL if neither missing test is mentioned.
