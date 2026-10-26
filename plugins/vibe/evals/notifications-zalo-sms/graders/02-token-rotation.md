---
type: llm
---

PASS if the answer explains that the OA access token expires (about a day) and the refresh token is rotated or single-use, so refreshing must happen in one place (a scheduled job or a lock/lease) and the new token pair must be stored atomically, with a plan for when the refresh token is lost or expired (the spa re-authorizes the OA).
FAIL if token refresh is not discussed or is left to each sender independently.
