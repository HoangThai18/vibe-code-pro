---
type: llm
---

PASS if the design says how the scheduled scan finds due appointments across all spas when RLS is on: it notes that a query as the app role without a tenant set sees no rows (or that a cross-tenant scan needs special access), lists tenants through something narrow (for example a `SECURITY DEFINER` function that returns only active tenant ids, or a separate role used only for that list), and does the per-spa scan and enqueueing inside that spa's tenant context.
FAIL if the scan queries all appointments without addressing RLS, or simply runs the whole job as a superuser, table owner or BYPASSRLS connection.
