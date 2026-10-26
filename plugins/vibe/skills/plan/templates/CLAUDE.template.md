# Tên dự án

1–2 câu: sản phẩm là gì, cho ai.

## Lệnh
- Cài đặt: `pnpm install`
- Chạy dev: `pnpm dev`
- Test: `pnpm test` · một file: `pnpm test -- path/to/file`
- Lint / typecheck: `pnpm lint` / `pnpm typecheck`
- Build: `pnpm build`
- Migration: `pnpm db:migrate` · tạo mới: `pnpm db:new <tên>`

## Cấu trúc
- `apps/web`: frontend
- `apps/api`: backend
- `packages/contracts`: schema API dùng chung (nguồn sự thật cho BE và FE)
- `docs/plan/`: PRD, kiến trúc, phase · `docs/tasks/`: task card · `docs/STATUS.md`: tiến độ

## Quy tắc bắt buộc
- Mọi truy vấn bảng thuộc tenant chạy trong transaction có tenant context; không nhận tenant_id từ client.
- API theo contract trong `packages/contracts`; đổi API thì sửa contract trước.
- Không thêm dependency mới khi task không yêu cầu.
- Migration: mỗi lúc chỉ một task tạo migration; an toàn với bảng đã có dữ liệu.

## Quy ước
- Module mẫu để bắt chước: `src/modules/<tên>/` (routes, service, repository, schema)
- Đặt tên: ...
- Báo lỗi: class lỗi chung có `code` (`src/shared/errors.ts`), map sang HTTP ở middleware
- Validate: schema ở biên (route/DTO), dùng chung với FE qua contract
- Test: vị trí file, cách tạo dữ liệu, mức mock
- Format lỗi API: `{ "error": { "code", "message", "details", "requestId" } }`
- Commit: `<TASK-ID>: <mô tả>`

## Ghi chú stack
- (Thư viện hay đổi API: version + link research note, vd "Prisma 6: xem docs/research/prisma.md")

## Công cụ cho Claude
- (Chỉ ghi công cụ đã cài cho dự án này, kèm giới hạn dùng. Vd: "Context7: hỏi kèm tên thư viện và version", "Supabase MCP: chỉ dự án dev, read_only", "Chrome DevTools MCP: chỉ mở app local/staging bằng tài khoản test". Chưa cài gì thì xoá mục này.)

## Quy trình
Dự án dùng bộ skill `vibe`: plan → tasks → build (một agent làm cả code và test) → review → ship. Chỉ session chính cập nhật task card và `docs/STATUS.md`; sub-agent (nếu có) báo cáo kết quả thay vì tự sửa.
