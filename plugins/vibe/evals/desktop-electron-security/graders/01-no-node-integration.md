---
type: regex
pattern: 'nodeIntegration\s*:\s*true'
match: not_contains
target:
  source: file
  path: main.js
---
