---
# Content written with Write/Edit (a `files` target matches file names only)
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"(?:replace_all|file_path|old_string)":(?:"(?:[^"\\]|\\.)*"|true|false),)*"(?:content|new_string)":"(?:[^"\\]|\\.)*?(?:\.RequireRole\(|\[Authorize\((?:[^\]"\\]|\\.)*Roles(?:\s|\\[nrt])*=|new(?:\s|\\[nrt])+Claim\((?:\s|\\[nrt])*ClaimTypes\.Role)'
match: not_contains
---
