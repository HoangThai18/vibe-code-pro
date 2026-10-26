---
type: llm
focus:
  source: file
  path: src/ai/summarize-notes.ts
---

PASS if the request sets max_tokens, the code checks stop_reason (refusal or max_tokens) before using the output, and API failures such as rate limits, overload or timeouts are turned into an error the UI can show as "AI temporarily unavailable" instead of crashing the caller.
FAIL if any of those three is missing.
