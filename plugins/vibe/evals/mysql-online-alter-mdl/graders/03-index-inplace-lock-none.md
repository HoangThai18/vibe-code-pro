---
type: regex
target: files
pattern: '(?:INDEX|KEY)[^;]*(?:ALGORITHM\s*=\s*INPLACE[^;]*LOCK\s*=\s*NONE|LOCK\s*=\s*NONE[^;]*ALGORITHM\s*=\s*INPLACE)'
flags: i
match: contains
---
