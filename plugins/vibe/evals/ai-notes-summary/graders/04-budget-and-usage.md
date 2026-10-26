---
type: llm
focus:
  source: file
  path: src/ai/summarize-notes.ts
---

PASS if the code checks the tenant's monthly AI budget (AiUsageStore.monthCostMicroUsd against monthBudgetMicroUsd) before calling the API, and records usage per tenant (AiUsageStore.record with tenantId and the response usage) after the call.
FAIL if either the budget check or the usage record is missing.
