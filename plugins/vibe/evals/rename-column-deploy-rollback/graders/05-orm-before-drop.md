---
type: llm
---

PASS if, before customer_name is dropped, the plan removes it from the application's ORM model, queries or SELECT lists (deployed first), because code that still references the column breaks the moment it is dropped.
FAIL if the drop is planned without first removing the old column from the code's data mapping.
