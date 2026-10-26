---
type: llm
focus: files
---

PASS if the main process opens the file picker itself (dialog.showOpenDialog) and reads the chosen file, and the preload exposes only a task-specific function through contextBridge (not ipcRenderer itself, not a generic readFile(path) that takes a path from the renderer).
FAIL if the renderer can still pass an arbitrary path to be read, or the preload exposes ipcRenderer or a generic file API.
