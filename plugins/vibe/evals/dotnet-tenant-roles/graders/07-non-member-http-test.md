---
type: llm
---

PASS if the change adds at least one HTTP test (through `WebApplicationFactory`, as `tests/Spa.Api.Tests/CustomerTests.cs` does) in which a signed-in user who is not a member of the tenant in the path gets 404.
FAIL if that test is only listed as missing or proposed.
