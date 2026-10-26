---
type: llm
---

PASS if amounts are stored and passed as integers in the currency's smallest unit (đồng for VND) together with an explicit currency code per price, tenant or branch (VND in Vietnam, SGD in Singapore), and the currency is never chosen from the UI language.
FAIL if amounts are floats, or the currency follows the selected language.
