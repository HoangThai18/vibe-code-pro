---
type: llm
---

PASS if the response notes that the application must connect with a role that is not a superuser, has no BYPASSRLS and does not own the table (or the table uses FORCE ROW LEVEL SECURITY), otherwise the policies are silently bypassed.
FAIL if this is not mentioned.
