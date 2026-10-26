---
type: llm
focus:
  source: file
  path: src/link-preview.ts
---

PASS if redirects are either disabled or followed manually with every redirect target going through the same scheme and address checks.
FAIL if fetch follows redirects automatically after only checking the first URL.
