---
type: llm
focus:
  source: file
  path: src/customers/customer.service.js
---

PASS if both create and update reject a phone already used by another customer in the same tenant with `AppError('customer_phone_taken', 409)`, comparing the normalized phone, and update does not reject a customer keeping its own phone.
FAIL if either create or update lacks the check.
