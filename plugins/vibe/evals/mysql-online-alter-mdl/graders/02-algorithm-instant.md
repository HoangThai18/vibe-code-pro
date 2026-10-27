---
# Content written with Write/Edit (a `files` target matches file names only)
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"(?:replace_all|file_path|old_string)":(?:"(?:[^"\\]|\\.)*"|true|false),)*"(?:content|new_string)":"(?:[^"\\]|\\.)*?(?:reminder_sent_at(?:[^;"\\]|\\.)*ALGORITHM(?:\s|\\[nrt])*=(?:\s|\\[nrt])*INSTANT)'
flags: i
match: contains
---
