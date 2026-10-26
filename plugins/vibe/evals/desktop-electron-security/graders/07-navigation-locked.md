---
type: llm
focus: files
---

PASS if main.js stops the window from navigating to other origins (a will-navigate handler that prevents it) and denies or controls new windows (setWindowOpenHandler).
FAIL if either navigation or new windows are left unrestricted.
