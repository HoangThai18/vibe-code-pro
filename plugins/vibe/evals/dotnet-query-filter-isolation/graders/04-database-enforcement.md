---
type: llm
---

PASS if the answer says query filters alone are not enough and recommends enforcement in the database: PostgreSQL row-level security with FORCE, the app connecting as a role that is not a superuser, not the table owner and without BYPASSRLS, and the tenant set per request inside a transaction (for example `set_config('app.tenant_id', ..., true)` as the first statement).
FAIL if it recommends only fixing the individual queries, suggests RLS while the app keeps connecting as a superuser or the table owner, or sets the tenant at session level (a plain `SET app.tenant_id` on a pooled connection).
