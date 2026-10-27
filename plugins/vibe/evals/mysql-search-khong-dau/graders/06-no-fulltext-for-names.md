---
type: llm
focus: trace
---

PASS if name search does not depend on a FULLTEXT (ngram) index, or, if one is proposed, the answer states that the FULLTEXT index covers every tenant (it cannot start with tenant_id), so a small tenant's search costs as much as the largest tenant's, and justifies it with a measurement.
FAIL if a FULLTEXT ngram index is the main mechanism for name search with no mention of that cost.
