---
type: llm
---

PASS if staging's noindex is decided per request at runtime (middleware/proxy reading the environment or host, password protection, or server/reverse-proxy config), or, if next.config.js headers() is used, the answer notes that it is fixed at build time.
FAIL if staging noindex depends on a build-time setting without saying so, or staging is not handled.
