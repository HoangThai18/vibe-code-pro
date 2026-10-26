---
type: llm
---

PASS if the proposed flow includes all of: a new production build, testing before the public release (TestFlight, a Play internal/closed track, or a preview/internal build on real devices), a gradual release (App Store phased release or Play staged rollout), and declaring the camera permission explanation (NSCameraUsageDescription or the expo-camera config plugin's permission text).
FAIL if any of those four is missing.
