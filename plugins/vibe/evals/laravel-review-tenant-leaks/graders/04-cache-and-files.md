---
type: llm
---

PASS if the review reports at least one of: the cache key `customers:total` has no tenant id, so spas see each other's count; the export path `exports/customers-{date}.csv` has no tenant id, so spas overwrite or download each other's file. A fix puts the tenant id in the key or path.
FAIL if neither is reported.
