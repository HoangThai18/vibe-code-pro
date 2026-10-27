---
type: regex
target: files
pattern: '\.RequireRole\(|\[Authorize\([^\]]*Roles\s*=|new\s+Claim\(\s*ClaimTypes\.Role'
match: not_contains
---
