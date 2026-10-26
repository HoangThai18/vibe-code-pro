---
type: llm
focus:
  source: file
  path: src/link-preview.ts
---

PASS if the connection is made to the same address that was checked (for example a custom DNS lookup on the HTTP agent/dispatcher that validates at connect time, or connecting to the validated IP with the Host header set), so a DNS answer that changes between check and connect (DNS rebinding) cannot reach an internal address.
FAIL if the code resolves and checks the hostname, then calls fetch with the hostname so a second DNS lookup decides where it connects.
