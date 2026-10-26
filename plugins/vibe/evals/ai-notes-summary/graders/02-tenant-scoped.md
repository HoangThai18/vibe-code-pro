---
type: llm
focus:
  source: file
  path: src/ai/summarize-notes.ts
---

PASS if notes are loaded through the NotesRepository using ctx.tenantId (the tenant from the authenticated context), not a tenantId taken from the caller's input or omitted.
FAIL otherwise.
