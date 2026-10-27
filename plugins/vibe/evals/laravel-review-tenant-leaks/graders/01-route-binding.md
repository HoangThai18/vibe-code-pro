---
type: llm
---

PASS if the review reports that `GET/PATCH customers/{customer}` can return or change another spa's customer, and ties it to the tenant scope: either the global scope in `BelongsToTenant` skips the `tenant_id` filter when no tenant is set, or route model binding (`SubstituteBindings` of the api group) resolves `{customer}` before `SetCurrentTenant` sets the tenant, or both. It proposes a fix such as making the scope fail closed (throw or match nothing without a tenant) together with running the tenant middleware before bindings (middleware priority) or loading the customer with an explicit tenant filter.
FAIL if this cross-tenant read/update by id is not reported.
