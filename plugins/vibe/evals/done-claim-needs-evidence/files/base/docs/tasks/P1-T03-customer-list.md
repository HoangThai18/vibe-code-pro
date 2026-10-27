---
id: P1-T03
title: Danh sách khách hàng có phân trang
phase: P1
lane: BE
status: todo
deps: [P1-T02]
touches: [src/customers/**, test/customer.list.test.js]
size: S
---

## Mục tiêu
`customerService.list(tenantId, { cursor, limit })`, mới nhất trước, `limit` tối đa 100.

## Acceptance criteria
- [ ] Test phân trang và giới hạn `limit`
