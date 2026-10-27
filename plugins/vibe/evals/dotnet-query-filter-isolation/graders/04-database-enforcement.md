---
type: llm
---

PASS if the answer says query filters alone are not enough and recommends enforcement in the database: PostgreSQL row-level security with FORCE, the app connecting as a role that is not a superuser, not the table owner and without BYPASSRLS (it notes the connection string uses `postgres`), and the tenant set per request inside a transaction (for example `set_config('app.tenant_id', ..., true)` as the first statement), plus isolation tests with two spas run as the app's role.
FAIL if it recommends only fixing the individual queries, or suggests RLS while keeping the superuser connection.
