---
type: llm
---

PASS if the answer covers users still on old builds: EAS Update stays usable afterwards only for JS-only fixes on the matching runtime, and the scan feature is gated (remote flag, minimum supported version, or a check that the build has the camera) instead of assuming every user has updated.
FAIL if it ignores users who stay on older builds.
