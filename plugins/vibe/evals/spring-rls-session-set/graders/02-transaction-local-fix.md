---
type: llm
---

PASS if the fix stops setting the tenant at session level in the filter and instead sets it with `set_config('app.tenant_id', ?, true)` (or `SET LOCAL`) inside the same transaction as the queries, as the first statement of every transaction (a transaction manager or JPA dialect hook, a `TransactionTemplate`/aspect wrapper, or an explicit call at the start of each transactional method), with the request's tenant kept in a request-scoped or thread-local holder that is cleared after the request.
FAIL if the session-level call stays the mechanism (for example adding `RESET`/`DISCARD ALL` in a finally block or on connection return, or a Hikari `connection-init-sql`), or the tenant is set outside the transaction that runs the queries.
