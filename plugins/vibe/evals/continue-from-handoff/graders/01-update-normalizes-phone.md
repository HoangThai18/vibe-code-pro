---
type: regex
target:
  source: file
  path: src/customers/customer.service.js
pattern: 'update\s*\([^)]*\)\s*\{[\s\S]*normalizePhone'
match: contains
---
