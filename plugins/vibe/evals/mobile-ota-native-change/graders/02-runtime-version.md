---
type: llm
---

PASS if the answer explains runtime version (for example runtimeVersion with the fingerprint policy): the new build gets a new runtime version, so updates for it never reach old binaries that lack the camera module, and a JS bundle that imports expo-camera would crash on those old binaries.
FAIL if runtime version is not mentioned.
