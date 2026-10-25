---
type: llm
---

PASS if the response makes each request carry the tenant explicitly (in the URL path, a route segment or a header) with the server checking membership, so a request and its cache key can never refer to different workspaces; or it equivalently derives both the key and the request from the same tenant id.
FAIL if the fix relies only on clearing the cache while requests still depend on an implicit "current tenant" in the server session.
