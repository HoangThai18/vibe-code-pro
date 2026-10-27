---
type: llm
---

PASS if the answer keeps the user-based read branch out of normal requests: for example the user context (such as `app.user_id`) is set only in the login / workspace-selection flow while normal requests set only the tenant, or the workspace list comes from a separate narrow function, so a normal query like "list this workspace's members" never also returns the current user's memberships in other tenants.
FAIL if every request sets both user and tenant context under a policy with `user_id = current user OR tenant_id = current tenant`, and the answer never addresses that this mixes the user's other-tenant memberships into normal queries.
