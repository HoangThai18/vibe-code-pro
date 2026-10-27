---
type: llm
---

PASS if the review reports that `code text NOT NULL UNIQUE` is unique across all tenants and should be `UNIQUE (tenant_id, code)`, with a consequence such as one spa being unable to create a code another spa already uses, or learning that another tenant's code exists.
FAIL if this is not reported.
