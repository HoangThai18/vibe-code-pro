---
type: llm
focus:
  source: file
  path: test/customer.service.test.js
---

PASS if the file has a test where tenant B tries to update tenant A's customer and gets `not_found`, and the test checks that tenant A's customer is unchanged.
FAIL otherwise.
