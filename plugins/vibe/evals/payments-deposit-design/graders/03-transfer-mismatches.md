---
type: llm
---

PASS if bank transfers are matched by a payment code in the transfer note, and the answer covers: customers who change or omit the note (a manual matching queue), partial or over payments (sent to review, not auto-confirmed), and duplicate webhook deliveries (deduplicated by the provider's transaction id).
FAIL if any of these three cases is missing.
