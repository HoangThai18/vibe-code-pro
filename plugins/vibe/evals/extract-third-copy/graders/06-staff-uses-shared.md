---
type: regex
target:
  source: file
  path: src/modules/staff/staff.service.js
pattern: "import\\s*\\{[^}]*normalizePhone[^}]*\\}\\s*from\\s*['\"][^'\"]*shared[^'\"]*['\"]"
match: contains
---
