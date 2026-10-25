# shop-api

- Chạy test: `node --test`
- Module mới đặt ở `src/modules/<tên>/`: `<tên>.repository.js` (chỉ nơi này gọi `table()` của `src/shared/db.js`) → `<tên>.service.js` (validate, quy tắc nghiệp vụ, lỗi `AppError`) → `index.js` (chỉ export service). Mẫu: `src/modules/customers/`.
- Số điện thoại luôn chuẩn hoá bằng `normalizePhone` trong `src/shared/phone.js`.
- `src/legacy/` là code của bản v1, đang chuyển dần sang `src/modules/`. Không thêm tính năng mới vào đó và không viết theo kiểu đó.
