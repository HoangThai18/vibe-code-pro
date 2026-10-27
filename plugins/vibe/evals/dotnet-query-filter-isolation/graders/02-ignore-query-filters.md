---
type: llm
---

PASS if the answer reports that `IgnoreQueryFilters()` in the trash list (`/deleted`) and in `/restore` removes the tenant condition together with the soft-delete one, so a spa sees and can restore other spas' deleted customers, and proposes a fix such as EF Core 10 named query filters with `IgnoreQueryFilters(["SoftDelete"])` (ignoring only the soft-delete filter), separate filters, or an explicit tenant condition in those queries.
FAIL if this is not reported.
