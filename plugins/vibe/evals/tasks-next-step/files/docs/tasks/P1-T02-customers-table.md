---
id: P1-T02
title: Bảng customers + RLS
phase: P1
lane: DB
status: doing
deps: [P0-T02]
touches: [db/migrations/**, db/schema/customers.ts]
size: S
---

## Mục tiêu
Bảng `customers` thuộc tenant: `tenant_id NOT NULL`, `UNIQUE (tenant_id, id)`, `UNIQUE (tenant_id, email)`, index `(tenant_id, created_at DESC)`, RLS + FORCE.

## Acceptance criteria
- [ ] Migration chạy trên DB có dữ liệu mẫu, không lỗi
- [ ] Câu kiểm tra RLS của skill `backend` (`references/postgres-rls.md` mục 8) trả rỗng
- [ ] Insert trùng email trong cùng tenant bị từ chối; khác tenant thì được
