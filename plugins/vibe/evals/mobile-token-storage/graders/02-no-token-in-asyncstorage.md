---
type: regex
pattern: 'AsyncStorage\.(setItem|multiSet|mergeItem)\([^)]*(token|access_key|refresh_key)'
flags: i
match: not_contains
target:
  source: file
  path: src/auth/session.ts
---
