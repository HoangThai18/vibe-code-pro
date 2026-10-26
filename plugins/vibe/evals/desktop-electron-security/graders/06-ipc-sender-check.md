---
type: llm
focus:
  source: file
  path: main.js
---

PASS if the IPC handler in main.js checks who sent the message (for example event.senderFrame origin or URL, or the webContents of the app's own window) before doing the work.
FAIL if the handler accepts the message from any frame without checking the sender.
