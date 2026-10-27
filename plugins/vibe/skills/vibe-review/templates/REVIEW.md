# Review P1-T03: BLOCK
Date: YYYY-MM-DD · Diff: phase/P1...task/P1-T03 · Verifier: vibe-verifier (or "self-review")

## Automated checks
| Command | Result |
|---|---|
| pnpm typecheck | ✅ |
| pnpm --filter api test | ❌ customers.isolation › cross-tenant PATCH |

## Acceptance criteria
| Criterion | Evidence | Met |
|---|---|---|
| Read/update another tenant's id → 404 | customers.isolation.test.ts | ❌ PATCH returns 200 |

## Findings
### 🔴 PATCH /v1/t/{tenantId}/customers/{id} updates another tenant's customer
- apps/api/src/modules/customers/repo.ts:42: updates by id, outside a transaction with tenant context
- Scenario: a tenant A user sends `PATCH /v1/t/<A>/customers/<B's customer id>` → B's record changes
- Fix: use withTenant() like the read functions; add the case to the table test

## Follow-up (PASS + follow-up only)
- 🟡 ... → task card P1-T09
