---
id: P1-T06
title: Bảng ghi chú khách hàng + RLS
phase: P1
lane: DB
status: todo
deps: [P1-T02]
touches: [db/migrations/**, db/schema/notes.ts]
size: S
---

## Mục tiêu
Bảng `customer_notes` thuộc tenant, composite FK `(tenant_id, customer_id) → customers(tenant_id, id)` để không gắn được ghi chú sang khách của tenant khác.

## Acceptance criteria
- [ ] Insert note với customer_id của tenant khác bị DB từ chối (test)
- [ ] RLS + FORCE bật, index `(tenant_id, customer_id, created_at DESC)`
