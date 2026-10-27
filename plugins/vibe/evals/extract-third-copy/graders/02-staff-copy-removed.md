---
type: regex
target:
  source: file
  path: src/modules/staff/staff.service.js
pattern: '(?:function\s+normalizePhone|(?:const|let)\s+normalizePhone\s*=)'
match: not_contains
---
