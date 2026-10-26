---
type: llm
---

PASS if each public page gets its own absolute canonical URL (metadataBase plus a per-page alternates.canonical, or an absolute URL per page), and the answer does not put a canonical or openGraph.url in the root layout where every page would inherit it.
FAIL if the canonical is missing or set once in the root layout for all pages.
