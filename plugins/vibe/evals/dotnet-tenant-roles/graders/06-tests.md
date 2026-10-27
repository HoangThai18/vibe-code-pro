---
type: llm
---

PASS if the change adds tests that cover the role × permission matrix (table-driven, for example an xUnit `[Theory]` with one row per role and permission) and at least one HTTP test that a user who is not a member of the tenant gets 404.
FAIL if either is missing.
