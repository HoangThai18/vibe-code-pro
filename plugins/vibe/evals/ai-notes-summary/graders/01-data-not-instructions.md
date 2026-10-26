---
type: llm
focus:
  source: file
  path: src/ai/summarize-notes.ts
---

PASS if the customer notes are put into the user message as clearly delimited data (JSON.stringify or named tags/delimiters), the system prompt is fixed text with no note content interpolated into it, and the prompt tells the model that the note text is data and must not be followed as instructions.
FAIL if note text is concatenated into the system prompt, or inserted into the prompt without delimiting and without saying it is data.
