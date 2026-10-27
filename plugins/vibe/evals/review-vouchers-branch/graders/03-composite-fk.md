---
type: llm
---

PASS if the review reports that vouchers.customer_id has no foreign key, and that it should be a composite key `FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id)` (as appointments does), so a voucher cannot point at a missing customer or another tenant's customer.
FAIL if the missing or non-composite foreign key is not reported.
