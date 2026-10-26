---
type: llm
---

PASS if only a server-to-server callback (VNPay IPN, bank-transfer webhook) whose signature or key is verified with that spa's own credentials marks a deposit paid, the return URL only displays status, the amount is checked against the stored amount, and repeated callbacks change nothing.
FAIL if the return/redirect URL can mark a payment paid, or the amount or signature check is missing.
