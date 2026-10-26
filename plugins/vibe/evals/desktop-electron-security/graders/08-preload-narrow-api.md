---
type: llm
focus:
  source: file
  path: preload.js
---

PASS if preload.js uses contextBridge.exposeInMainWorld to expose only task-specific functions (for example importCustomersCsv()) that call fixed IPC channels and take no file path.
FAIL if it exposes ipcRenderer itself, a generic invoke/send that takes any channel name, Node modules, or a function that reads a path given by the renderer; also FAIL if the file does not exist.
