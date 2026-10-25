---
id: P1-T01
title: Contract API khách hàng
phase: P1
lane: BE
status: done
deps: [P0-T03]
touches: [packages/contracts/src/customers.ts, docs/contracts/customers.md, apps/web/src/mocks/**]
size: S
---

## Mục tiêu
Task này tạo contract. Chốt schema dùng chung (zod) cho list / get / create / update / archive khách hàng để BE (P1-T03) và FE (P1-T04, P1-T05) làm song song.

## Acceptance criteria
- [x] Schema `Customer`, `CreateCustomerInput`, `UpdateCustomerInput`, `ListCustomersQuery`, `ListCustomersResponse`
- [x] Ví dụ payload happy + lỗi (`customer_email_taken`, `validation_failed`) trong docs/contracts/customers.md
- [x] Mock MSW cho 5 endpoint
