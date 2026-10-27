---
type: regex
target:
  source: file
  path: src/customers/import-csv.js
pattern: "\\.split\\(\\s*(?:['\"],['\"]|/,/)"
match: not_contains
---
