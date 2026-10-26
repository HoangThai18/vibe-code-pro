---
id: P1-T01
title: Customer API contract
phase: P1
lane: BE
status: done
deps: [P0-T03]
touches: [packages/contracts/src/customers.ts, docs/contracts/customers.md, apps/web/src/mocks/**]
size: S
---

## Goal
This task creates the contract. Fix the shared (zod) schemas for list / get / create / update / archive customers so BE (P1-T03) and FE (P1-T04, P1-T05) can work in parallel.

## Acceptance criteria
- [x] Schemas `Customer`, `CreateCustomerInput`, `UpdateCustomerInput`, `ListCustomersQuery`, `ListCustomersResponse`
- [x] Happy and error payload examples (`customer_email_taken`, `validation_failed`) in docs/contracts/customers.md
- [x] MSW mocks for the 5 endpoints
