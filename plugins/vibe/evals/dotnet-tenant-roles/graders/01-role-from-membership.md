---
type: llm
---

PASS if the answer advises against a role claim in the JWT with `RequireRole` (or `[Authorize(Roles = ...)]`), because the role belongs to the membership in each spa (one user can be owner in one spa and staff in another) or because a token keeps a stale role, and the code reads the role on each request from the `memberships` row for the tenant in the path and the signed-in user.
FAIL if the solution authorizes from a role claim in the token, or from one global role per user.
