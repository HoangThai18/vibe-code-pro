---
type: llm
---

PASS if, before expiring an unpaid deposit, the system asks the provider for the transaction status (for example VNPay querydr) because callbacks can be late or lost, and there is a daily reconciliation against the provider's or bank's records.
FAIL if pending payments are simply expired on a timer, or reconciliation is not mentioned.
