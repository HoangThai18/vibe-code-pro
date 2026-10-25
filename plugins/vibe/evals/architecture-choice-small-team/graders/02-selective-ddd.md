---
type: llm
---

PASS if DDD or clean/hexagonal architecture is applied selectively: to the complex booking domain (deposits, cancellation, no-show, staff overlap) and/or external integration boundaries, while the mostly-CRUD parts stay simple.
FAIL if one style is prescribed for every module, or DDD is rejected or required wholesale without distinguishing the booking domain.
