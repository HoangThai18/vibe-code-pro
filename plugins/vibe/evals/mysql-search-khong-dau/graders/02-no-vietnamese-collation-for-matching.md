---
# Content written with Write/Edit (a `files` target matches file names only)
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"(?:replace_all|file_path|old_string)":(?:"(?:[^"\\]|\\.)*"|true|false),)*"(?:content|new_string)":"(?:[^"\\]|\\.)*?(?:(?:MODIFY|CHANGE)(?:\s|\\[nrt])+(?:COLUMN(?:\s|\\[nrt])+)?`?full_name`?(?:[^;"\\]|\\.)*utf8mb4_vi_0900|CONVERT(?:\s|\\[nrt])+TO(?:\s|\\[nrt])+CHARACTER(?:\s|\\[nrt])+SET(?:\s|\\[nrt])+utf8mb4(?:\s|\\[nrt])+COLLATE(?:\s|\\[nrt])*=?(?:\s|\\[nrt])*utf8mb4_vi_0900|full_name`?(?:\s|\\[nrt])+COLLATE(?:\s|\\[nrt])+utf8mb4_vi_0900_\w+(?:\s|\\[nrt])+LIKE)'
flags: i
match: not_contains
---
