---
type: llm
---

PASS if the answer reports that `AddDbContextPool` reuses `AppDbContext` instances across requests, so the `TenantId` that `TenantMiddleware` set for an earlier request is still on the instance when a request that skips the middleware gets it, and names the Zalo opt-out webhook (no tenant in its path) as such a request: it searches and updates customers of whichever spa the previous request used (or none). The fix must make that path choose its tenant explicitly (for example from the OA id) and stop relying on leftover context state (no pooling for a stateful context, resetting the tenant on every use, or enforcing the tenant in the database).
FAIL if pooling is not mentioned as a leak, or the webhook problem is not reported.
