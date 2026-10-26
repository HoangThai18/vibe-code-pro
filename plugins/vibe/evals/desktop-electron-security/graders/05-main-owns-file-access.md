---
type: llm
focus:
  source: file
  path: main.js
---

PASS if main.js opens the file picker itself (dialog.showOpenDialog or showOpenDialogSync) inside an IPC handler and reads the chosen file there, so the renderer never supplies the path to read.
FAIL if an IPC handler reads a file path sent by the renderer, or main.js has no IPC handler for the import.
