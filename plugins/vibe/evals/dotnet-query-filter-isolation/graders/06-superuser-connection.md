---
type: llm
---

PASS if the answer notices that `appsettings.json` connects as `postgres` (a superuser), so today the database enforces nothing and RLS would be bypassed even if enabled, and says to connect as a dedicated app role instead.
FAIL if the connection's user is not mentioned.
