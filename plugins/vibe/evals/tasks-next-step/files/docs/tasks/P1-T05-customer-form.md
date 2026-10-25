---
id: P1-T05
title: Form tạo/sửa khách hàng
phase: P1
lane: FE
status: todo
deps: [P1-T01]
touches: [apps/web/src/features/customers/form/**, apps/web/src/routes.tsx]
size: M
---

## Mục tiêu
Form tạo/sửa theo mockup "Customers / Form", validate bằng schema chung, hiện lỗi `customer_email_taken` ngay dưới ô email.

## Acceptance criteria
- [ ] Validate phía client dùng `CreateCustomerInput` từ packages/contracts
- [ ] Lỗi từ server hiển thị đúng field
- [ ] Animation mở drawer theo motion spec (200ms, ease-out), tắt khi prefers-reduced-motion
