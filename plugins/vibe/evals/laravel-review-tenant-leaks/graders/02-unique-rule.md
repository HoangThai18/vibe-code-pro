---
type: llm
---

PASS if the review reports that `Rule::unique('customers', 'phone')` in StoreCustomerRequest/UpdateCustomerRequest checks every tenant (validation rules ignore Eloquent global scopes), so a spa cannot add a customer whose phone another spa already has and learns that it exists, and proposes adding `->where('tenant_id', ...)` or relying on the `UNIQUE (tenant_id, phone)` index with a 409.
FAIL if this is not reported.
