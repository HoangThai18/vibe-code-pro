# Chiến lược test và E2E

Test để giảm rủi ro, không để đạt con số coverage. Câu hỏi đúng là "nếu chỗ này hỏng thì mất gì, và test ở mức nào bắt được nó rẻ nhất?".

## Mục lục
1. Chọn mức test theo loại logic
2. Integration với DB thật
3. E2E bằng Playwright
4. Dữ liệu test
5. Test chập chờn (flaky)
6. Test trong CI
7. `docs/TESTING.md`

## 1. Chọn mức test theo loại logic

| Loại logic | Mức test | Vì sao |
|---|---|---|
| Tính toán thuần (giá, chiết khấu, làm tròn, slug, state machine) | Unit | Nhanh, nhiều trường hợp biên |
| Query, transaction, migration, RLS, ràng buộc DB | Integration với DB thật | Mock DB thì không bắt được lỗi SQL, constraint, RLS |
| Endpoint: validate, phân quyền, cô lập tenant, format lỗi | Integration qua HTTP (supertest, httpx...) | Kiểm hợp đồng thật của API |
| Contract BE ↔ FE | Validate response bằng schema dùng chung | Bắt lệch contract sớm |
| Component có logic (form, bảng lọc) | Component test + MSW | Không cần dựng cả app |
| Luồng người dùng quan trọng (đăng ký, đặt lịch, thanh toán) | E2E, số lượng ít | Bắt lỗi ghép nối giữa các phần |

Không mock chính thứ đang test. Bug fix luôn kèm một test tái hiện bug: fail trước khi sửa, pass sau khi sửa.

## 2. Integration với DB thật

- Chạy Postgres bằng container (Testcontainers hoặc docker compose), cùng major version với production.
- Mỗi lần chạy: migrate DB test từ đầu, để kiểm luôn migration.
- Test chạy bằng **role giống app** (không superuser), nếu không thì RLS bị bỏ qua và test pass sai.
- Cô lập giữa các test: transaction rollback sau mỗi test, hoặc dữ liệu có tiền tố riêng cho từng test. Chạy song song thì mỗi worker một database hoặc schema.

## 3. E2E bằng Playwright

Chỉ cho vài luồng đáng tiền nhất (đăng nhập, luồng tạo giá trị chính, thanh toán, phân quyền theo vai trò, đổi workspace), mỗi phase thêm luồng của phase đó. Cấu hình, đăng nhập theo vai trò, fixture dữ liệu, luồng nhiều vai trò, giờ server và giờ trình duyệt, mock mạng, so ảnh, a11y, debug và CI: `e2e-playwright.md` (cùng thư mục).

## 4. Dữ liệu test

- Mỗi test tự tạo dữ liệu nó cần (qua API hoặc fixture), tên duy nhất; không dựa vào dữ liệu test khác để lại, không dựa vào thứ tự chạy.
- Seed dùng chung (tài khoản, tenant A/B) tạo bằng script idempotent, chạy trước bộ E2E.
- Không chạy E2E vào production. Staging dùng dữ liệu giả hoặc đã ẩn danh hoá.

## 5. Test chập chờn (flaky)

Nguyên nhân hay gặp: chờ bằng thời gian cố định, dữ liệu dùng chung giữa các test, phụ thuộc thứ tự, animation, múi giờ/ngày hiện tại, gọi dịch vụ bên ngoài thật.

- Sửa tận gốc: assertion tự chờ, dữ liệu riêng cho từng test, cố định thời gian (fake timers, `TZ=Asia/Ho_Chi_Minh` hoặc UTC thống nhất), mock dịch vụ ngoài.
- Kiểm đã hết chập chờn: chạy lặp nhiều lần và song song (Playwright: `--repeat-each=5 --workers=4`; Vitest/Jest: chạy lặp file test trong vòng lặp shell).
- Test không sửa được ngay: đánh dấu skip **kèm task card** sửa và hạn chót. Đừng tăng retry để che lỗi.

## 6. Test trong CI

- Mỗi PR: lint, typecheck, unit, integration (có DB service), build. Đây là check bắt buộc trước khi merge.
- E2E: chạy trên PR với các luồng quan trọng, hoặc hằng đêm và trước khi release nếu bộ E2E chậm. Lưu report và trace khi fail.
- Pipeline mẫu ở skill `ship` (từ file này: `../../ship/references/ci-cd.md`).

## 7. `docs/TESTING.md`

Ghi cho cả team và agent: lệnh chạy từng loại test, cách dựng DB test, tài khoản và tenant mẫu, luồng nào có E2E, quy ước đặt tên. Thêm lệnh vào `CLAUDE.md`.
