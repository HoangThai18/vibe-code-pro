---
type: regex
target: files
pattern: '(?:MODIFY|CHANGE)\s+(?:COLUMN\s+)?`?full_name`?[^;]*utf8mb4_vi_0900|CONVERT\s+TO\s+CHARACTER\s+SET\s+utf8mb4\s+COLLATE\s*=?\s*utf8mb4_vi_0900|full_name`?\s+COLLATE\s+utf8mb4_vi_0900_\w+\s+LIKE'
flags: i
match: not_contains
---
