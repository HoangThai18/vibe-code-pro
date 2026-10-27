---
# Content written with Write/Edit (a `files` target matches file names only)
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"(?:replace_all|file_path|old_string)":(?:"(?:[^"\\]|\\.)*"|true|false),)*"(?:content|new_string)":"(?:[^"\\]|\\.)*?(?:(?:INDEX|KEY)(?:[^;"\\]|\\.)*(?:ALGORITHM(?:\s|\\[nrt])*=(?:\s|\\[nrt])*INPLACE(?:[^;"\\]|\\.)*LOCK(?:\s|\\[nrt])*=(?:\s|\\[nrt])*NONE|LOCK(?:\s|\\[nrt])*=(?:\s|\\[nrt])*NONE(?:[^;"\\]|\\.)*ALGORITHM(?:\s|\\[nrt])*=(?:\s|\\[nrt])*INPLACE))'
flags: i
match: contains
---
