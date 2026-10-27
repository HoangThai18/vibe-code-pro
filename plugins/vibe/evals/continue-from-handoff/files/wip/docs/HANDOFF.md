# Handoff, 2026-10-26 18:40

Đang làm **P1-T02** trên nhánh `task/P1-T02`. Sub-task 1 đã commit.

## Do first
1. `node --test` đang fail ở test `update stores the phone normalized`: `customerService.update` lưu thẳng `input.phone`, chưa qua `normalizePhone`. Code `update` và test này **chưa commit**.
2. Sub-task 3: số điện thoại trùng trong cùng tenant (khi tạo và khi sửa) → `AppError('customer_phone_taken', 409)`.
3. Sub-task 4: test cô lập tenant cho `update`.

## Lệnh
- `node --test`
