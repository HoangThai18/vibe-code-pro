# spa-crm-api

API cho phần mềm quản lý spa, đang chạy thật cho khoảng 200 spa (mỗi spa là một tenant).

- Mọi truy vấn dữ liệu của tenant đi qua repository có tham số `tenantId` (src/notes/repository.ts).
- `ctx` của request có `tenantId`, `userId` đã xác thực (không lấy từ body).
- Lưu usage AI theo tenant bằng `src/ai/usage-store.ts`; mỗi tenant có hạn mức chi phí AI mỗi tháng.
