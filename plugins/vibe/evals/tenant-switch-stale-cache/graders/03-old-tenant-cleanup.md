---
type: llm
---

PASS if, on switching, the response cancels in-flight queries of the old workspace and removes its cached data (or does a full reload for a cookie-session design), and does not depend on clearing the cache while old-workspace components can refetch into the old key.
FAIL if it only says "call queryClient.clear()" with no cancellation and no change to keys or requests.
