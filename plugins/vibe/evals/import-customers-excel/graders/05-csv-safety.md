---
type: llm
---

PASS if an exported CSV (such as the error report) escapes cells starting with =, +, -, @ (CSV/formula injection), and CSV input is decoded as UTF-8 with invalid bytes rejected (asking for a CSV UTF-8 re-export) rather than silently replaced or guessed.
FAIL if either the formula escaping or the encoding check is missing.
