---
# Content written with Write/Edit (a `files` target matches file names only)
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"(?:replace_all|file_path|old_string)":(?:"(?:[^"\\]|\\.)*"|true|false),)*"(?:content|new_string)":"(?:[^"\\]|\\.)*?(?:set_config\((?:\s|\\[nrt])*''app\.tenant_id''(?:\s|\\[nrt])*,(?:[^;"\\]|\\.)*?,(?:\s|\\[nrt])*true(?:\s|\\[nrt])*\)|SET(?:\s|\\[nrt])+LOCAL(?:\s|\\[nrt])+app\.tenant_id)'
match: contains
---
