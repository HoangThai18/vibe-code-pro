---
type: llm
---

PASS if every date/time formatting call shown passes an explicit IANA timeZone taken from the tenant or branch settings (for example Asia/Ho_Chi_Minh, Asia/Singapore), ideally through one shared formatting module, and the answer warns that formatting without it uses the server's or browser's zone.
FAIL if any toLocaleString or Intl.DateTimeFormat call shown has no timeZone, or the zone comes from the server.
