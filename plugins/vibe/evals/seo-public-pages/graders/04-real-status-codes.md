---
type: llm
---

PASS if an unpublished, deleted or unknown spa returns a real 404 (notFound()) and a changed slug returns a 301/308 redirect, and the answer warns not to wrap that lookup in loading.tsx or <Suspense> (streaming sends 200 first, giving soft 404s).
FAIL if it renders a 200 "not found" page, or does not address status codes for spa pages.
