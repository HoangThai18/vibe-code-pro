---
type: llm
focus: files
---

PASS if the created files include a repository, a service and an index.js under src/modules/suppliers/ (mirroring src/modules/customers/), plus a supplier test file under test/.
FAIL if supplier code is placed elsewhere (for example src/legacy/ or a single file) or the module has no separate repository and service.
