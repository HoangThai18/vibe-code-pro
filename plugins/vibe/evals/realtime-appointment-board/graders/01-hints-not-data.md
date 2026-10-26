---
type: llm
---

PASS if events carry only an event type, ids and optionally a version (no customer names, phone numbers or other record fields), and the client refetches through the normal API (for example TanStack Query invalidateQueries) instead of rendering or patching data from the event.
FAIL if events carry record data that the client displays or merges into its cache.
