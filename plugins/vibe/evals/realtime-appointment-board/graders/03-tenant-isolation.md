---
type: llm
---

PASS if the stream endpoint is tenant-scoped and authorized like other endpoints (401 without a session, 404 or 403 for a user who is not a member of that spa), events are filtered by tenant on the server, and there is a test or explicit check that an event of one spa never reaches another spa's stream.
FAIL if any of these is missing.
