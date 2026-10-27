# spa-crm

CRM cho chuỗi spa (nhiều tenant). Node 22, chưa có dependency.

- Test: `node --test`
- Cấu trúc: `src/<module>/<module>.repository.js` (chỉ nơi này đụng vào dữ liệu) → `<module>.service.js` (validate, quy tắc nghiệp vụ, lỗi `AppError`).
- Số điện thoại luôn chuẩn hoá bằng `normalizePhone` (`src/shared/phone.js`) trước khi lưu hoặc so sánh.
- Quy trình: task card trong `docs/tasks/`, mỗi task một nhánh `task/<ID>` tách từ `phase/P1`.
