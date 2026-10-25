---
id: P0-T02
title: Schema tenants, users, memberships + RLS
phase: P0
lane: DB
status: done
deps: [P0-T01]
touches: [db/migrations/**, db/schema/core.ts]
size: M
---

## Mục tiêu
Nền multi-tenant: bảng `tenants`, `users` (global), `memberships(tenant_id, user_id, role)`, role `app_user` không bypass RLS, helper `app_current_tenant()`.

## Acceptance criteria
- [x] Migration chạy được trên DB trống và rollback được
- [x] Role app không phải superuser, không BYPASSRLS
- [x] Không set tenant context → query bảng tenant trả 0 dòng (test SQL)
