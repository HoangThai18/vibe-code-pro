---
type: regex
target: files
pattern: 'ADD\s+(?:COLUMN\s+)?`?reminder_sent_at`?[^;]*,\s*ADD\s+(?:INDEX|KEY|UNIQUE)|ADD\s+(?:INDEX|KEY)[^;]*,\s*ADD\s+(?:COLUMN\s+)?`?reminder_sent_at'
flags: i
match: not_contains
---
