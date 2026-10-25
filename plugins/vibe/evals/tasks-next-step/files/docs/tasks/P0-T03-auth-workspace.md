---
id: P0-T03
title: Đăng nhập + chọn workspace
phase: P0
lane: BE
status: done
deps: [P0-T02]
touches: [apps/api/src/modules/auth/**, apps/api/src/routes.ts]
size: M
---

## Mục tiêu
User đăng nhập rồi chọn workspace mình là thành viên (chuyển tới `/t/{tenantId}/...`). Mọi API nghiệp vụ có tenant trong path (`/v1/t/{tenantId}/...`); server kiểm membership ở mỗi request rồi set `app.tenant_id` theo transaction.

## Acceptance criteria
- [x] Gọi API của workspace mình không phải thành viên → 404
- [x] Mỗi request chạy trong transaction có `set_config('app.tenant_id', ..., true)`
