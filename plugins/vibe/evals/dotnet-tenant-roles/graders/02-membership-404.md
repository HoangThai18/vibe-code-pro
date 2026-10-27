---
type: llm
---

PASS if the code checks, for every `/v1/t/{tenantId}` request, that the signed-in user has a membership in that tenant (a query filtered on that tenant id and the user id, run inside the request's transaction after `set_config`), returns 404 when there is none, and does this before the permission check, so a non-member gets 404, never 403.
FAIL if a non-member can reach the endpoints, gets 403, or the membership lookup is not filtered by the path tenant.
