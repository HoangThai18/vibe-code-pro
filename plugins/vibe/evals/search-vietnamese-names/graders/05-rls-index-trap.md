---
type: llm
focus: trace
---

PASS if the solution recognizes that under row-level security LIKE/ILIKE are not leakproof, so the planner cannot use the trigram index for the app_user role, and handles it: for example a SECURITY DEFINER search function owned by a role that bypasses RLS and applies the tenant filter itself, or measuring the query as app_user (not a superuser) and justifying the result.
FAIL if it assumes the trigram index will be used under RLS without considering this.
