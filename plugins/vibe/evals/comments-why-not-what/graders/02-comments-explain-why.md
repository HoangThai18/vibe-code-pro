---
type: llm
focus:
  source: file
  path: src/billing/total.js
---

PASS if every comment in the file explains a reason the code cannot show (a business rule such as applying the discount before VAT, rounding to whole đồng, the total never going below zero, a constraint), or the file has no comments at all and reads clearly. At most a few short comments.
FAIL if any comment restates what the next line does, labels sections ("// Step 1", "// Helpers"), describes the change itself, contains commented-out code, or the file has a docblock that only repeats parameter names and types.
