---
type: llm
---

PASS if the review reports that ExportCustomersCsv runs in the queue worker without the tenant (the job carries only the user id and CurrentTenant is empty there), so the export reads customers of every spa (or the wrong one), and proposes passing the tenant id into the job and setting the tenant context inside handle().
FAIL if this is not reported.
