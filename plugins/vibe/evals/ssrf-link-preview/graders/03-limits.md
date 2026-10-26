---
type: llm
focus:
  source: file
  path: src/link-preview.ts
---

PASS if the code allows only http and https URLs, has a timeout on the request, and limits how many bytes of the response body it reads.
FAIL if any of these three is missing.
