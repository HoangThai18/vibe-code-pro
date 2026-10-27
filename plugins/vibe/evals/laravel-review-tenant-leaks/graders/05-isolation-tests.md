---
type: llm
---

PASS if the review asks for tests with two tenants that the module lacks: for example spa A gets 404 on spa B's customer by id (read and update), spa B can create a phone spa A already has, and the export contains only the requesting spa's customers.
FAIL if no two-tenant isolation test is asked for.
