---
type: llm
---

PASS if the answer explains both parts of the cause: `set_config('app.tenant_id', ?, false)` in `TenantFilter` is session-level, so the value stays on the HikariCP connection after it goes back to the pool; and the filter's `JdbcTemplate` call and the request's later queries can run on different pooled connections, so a request can read with another spa's tenant (the value left by an earlier request).
FAIL if the pool/connection reuse mechanism is missing, or the cause is put elsewhere (for example only the RLS policies, a cache, or the frontend).
