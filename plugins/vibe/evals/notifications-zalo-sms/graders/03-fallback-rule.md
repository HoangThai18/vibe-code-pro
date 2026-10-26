---
type: llm
---

PASS if the answer falls back to SMS only when Zalo cannot reach that person (no Zalo account, user refused messages, invalid number), not on temporary Zalo errors or outages (those retry on Zalo), and uses one id per notification so a retry never sends twice.
FAIL if any Zalo error triggers an SMS, or double sending is not addressed.
