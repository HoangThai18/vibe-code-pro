---
id: P1-T03
title: Customer CRUD API
phase: P1
lane: BE
status: todo
deps: [P1-T01, P1-T02]
touches: [apps/api/src/modules/customers/**, apps/api/src/routes.ts, apps/api/test/isolation/customers.test.ts, apps/api/test/helpers/**]
size: M
---

## Goal
Spa staff manage their workspace's customers: list, view details, add, edit, archive. Serves the "Customer management" flow in the PRD.

## Context to read
- AGENTS.md (commands, tenant rules)
- packages/contracts/src/customers.ts and docs/contracts/customers.md (agreed contract)
- apps/api/src/modules/auth/ (reference module: route → service → repository)

## Sub-tasks
- [ ] Customers repository uses a transaction with tenant context (no manual tenant_id filtering)
- [ ] Service: create / update / archive, map unique email violation → `customer_email_taken` (409)
- [ ] Routes per contract, validate input with the shared schemas
- [ ] Register routes in apps/api/src/routes.ts
- [ ] API tests: happy path + validation + duplicate email + cursor pagination
- [ ] Tenant isolation tests (`vibe-backend` skill, `references/isolation-tests.md`): seed two tenants, call every endpoint as tenant A with B's data

## Acceptance criteria
- [ ] 5 endpoints match the contract (contract test validates responses with the shared schemas)
- [ ] List uses cursor pagination, `limit` at most 100
- [ ] A `tenantId` in the body is ignored: records always belong to the session's tenant
- [ ] Read/update/archive of another tenant's id → 404 (table-driven test for every route with `:id`)
- [ ] A's list contains none of B's records; the same test shows A still sees its own records (control, so the test can't pass on an empty result)
- [ ] Tests run as the app role (not superuser, no BYPASSRLS)

## How to verify
```bash
pnpm --filter api test -- customers
pnpm typecheck
```

## Out of scope
- Customer import from Excel (P2)
- Customer notes (P1-T06 does the DB part)

## Notes / decisions
