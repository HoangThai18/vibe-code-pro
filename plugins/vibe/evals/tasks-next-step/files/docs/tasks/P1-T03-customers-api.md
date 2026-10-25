---
id: P1-T03
title: API CRUD khách hàng
phase: P1
lane: BE
status: todo
deps: [P1-T01, P1-T02]
touches: [apps/api/src/modules/customers/**, apps/api/src/routes.ts, apps/api/test/isolation/customers.test.ts, apps/api/test/helpers/**]
size: M
---

## Mục tiêu
Nhân viên spa quản lý danh sách khách của workspace mình: xem danh sách, xem chi tiết, thêm, sửa, lưu trữ (archive). Phục vụ luồng "Quản lý khách hàng" trong PRD.

## Bối cảnh cần đọc
- CLAUDE.md (lệnh, quy tắc tenant)
- packages/contracts/src/customers.ts và docs/contracts/customers.md (contract đã chốt)
- apps/api/src/modules/auth/ (module mẫu: cấu trúc route → service → repository)

## Sub-tasks
- [ ] Repository customers dùng transaction có tenant context (không tự lọc tenant_id bằng tay)
- [ ] Service: create / update / archive, map lỗi unique email → `customer_email_taken` (409)
- [ ] Route theo contract, validate input bằng schema chung
- [ ] Đăng ký route trong apps/api/src/routes.ts
- [ ] Test API: happy path + validate + trùng email + phân trang cursor
- [ ] Test cô lập tenant (skill backend, `references/isolation-tests.md`): seed hai tenant, gọi mọi endpoint bằng tenant A với dữ liệu của B

## Acceptance criteria
- [ ] 5 endpoint khớp contract (contract test validate response bằng schema chung)
- [ ] List có phân trang cursor, `limit` tối đa 100
- [ ] Body có `tenantId` bị bỏ qua: bản ghi luôn thuộc tenant của phiên
- [ ] Đọc/sửa/archive id của tenant khác → 404 (test dạng bảng cho mọi route có `:id`)
- [ ] List của A không chứa bản ghi của B; cùng test đó A vẫn thấy bản ghi của chính mình (đối chứng, để test không pass vì trả rỗng)
- [ ] Test chạy bằng role app (không phải superuser, không BYPASSRLS)

## Cách verify
```bash
pnpm --filter api test -- customers
pnpm typecheck
```

## Ngoài phạm vi
- Import khách từ Excel (P2)
- Ghi chú khách hàng (P1-T06 làm phần DB)

## Ghi chú / quyết định
