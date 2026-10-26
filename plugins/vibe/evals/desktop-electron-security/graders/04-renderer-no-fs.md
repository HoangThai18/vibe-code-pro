---
type: regex
pattern: 'require\(\s*[''"](node:)?fs'
match: not_contains
target:
  source: file
  path: renderer/renderer.js
---
