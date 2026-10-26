---
type: regex
pattern: 'contextIsolation\s*:\s*false|sandbox\s*:\s*false'
match: not_contains
target:
  source: file
  path: main.js
---
