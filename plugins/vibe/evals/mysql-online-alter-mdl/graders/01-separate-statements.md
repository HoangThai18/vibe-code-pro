---
# Content written with Write/Edit (a `files` target matches file names only)
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"(?:replace_all|file_path|old_string)":(?:"(?:[^"\\]|\\.)*"|true|false),)*"(?:content|new_string)":"(?:[^"\\]|\\.)*?(?:ADD(?:\s|\\[nrt])+(?:COLUMN(?:\s|\\[nrt])+)?`?reminder_sent_at`?(?:[^;"\\]|\\.)*,(?:\s|\\[nrt])*ADD(?:\s|\\[nrt])+(?:INDEX|KEY|UNIQUE)|ADD(?:\s|\\[nrt])+(?:INDEX|KEY)(?:[^;"\\]|\\.)*,(?:\s|\\[nrt])*ADD(?:\s|\\[nrt])+(?:COLUMN(?:\s|\\[nrt])+)?`?reminder_sent_at)'
flags: i
match: not_contains
---
