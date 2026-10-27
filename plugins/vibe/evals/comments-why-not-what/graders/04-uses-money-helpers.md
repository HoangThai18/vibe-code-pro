---
type: regex
target:
  source: file
  path: src/billing/total.js
pattern: "from\\s+['\"]\\./(?:money|discount-codes)\\.js['\"]"
match: contains
---
