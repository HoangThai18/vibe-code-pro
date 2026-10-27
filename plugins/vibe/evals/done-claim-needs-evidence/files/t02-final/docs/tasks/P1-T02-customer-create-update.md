---
id: P1-T02
title: Tạo và sửa khách hàng
phase: P1
lane: BE
status: review
deps: [P1-T01]
touches: [src/customers/**, test/customer.service.test.js]
size: M
---

## Mục tiêu
`customerService.create` và `customerService.update` theo `docs/plan/customers.md`.

## Context to read
- AGENTS.md
- src/shared/phone.js, src/shared/errors.js

## Sub-tasks
- [x] 1. `create`: chuẩn hoá số điện thoại, validate
- [x] 2. `update`: chuẩn hoá số điện thoại khi sửa
- [x] 3. Số điện thoại trùng trong cùng tenant → `customer_phone_taken`
- [x] 4. Test cô lập tenant

## Acceptance criteria
- [ ] Tạo và sửa đều lưu số dạng `0912345678` (test `create stores the phone normalized`, `update stores the phone normalized`)
- [ ] Số điện thoại trùng trong cùng tenant bị từ chối **cả khi tạo và khi sửa** → `AppError('customer_phone_taken', 409)`; tenant khác dùng cùng số thì được
- [ ] Tenant B sửa khách của tenant A → `not_found`, dữ liệu của A không đổi

## Security
Dữ liệu cá nhân (tên, số điện thoại) của khách thuộc tenant. `tenantId` lấy từ request đã xác thực, không lấy từ body.

## How to verify
```bash
node --test
```

## Out of scope
- Danh sách khách hàng (P1-T03)

## Notes / decisions
- Nhánh `task/P1-T02`. Đã xong hết sub-task, test pass.
