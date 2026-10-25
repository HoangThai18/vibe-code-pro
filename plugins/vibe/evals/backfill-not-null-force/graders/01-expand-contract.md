---
type: llm
---

PASS if the plan adds phone_normalized as a nullable column first, backfills it, and only enforces NOT NULL in a later step, with application code writing the new column before the constraint is enforced.
FAIL if it adds the column as NOT NULL in one step or with a table rewrite on 5 million rows.
