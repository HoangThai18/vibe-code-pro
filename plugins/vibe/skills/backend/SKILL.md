---
name: backend
description: "Thiết kế và code tầng backend: schema DB, kiểu dữ liệu, ràng buộc, index, transaction, migration an toàn, dùng ORM đúng cách (Prisma, Drizzle, TypeORM, Sequelize, SQLAlchemy, Django, GORM, ActiveRecord), lưu file/object storage, multi-tenant (tenant_id, composite FK, Postgres RLS, test cô lập), API contract giữa BE và FE (endpoint, lỗi, phân trang, mock), job nền (hàng đợi, retry, cron), bảo mật ứng dụng (upload, SSRF, rate limit, quét secret), dữ liệu cá nhân theo luật Việt Nam. Dùng khi tạo/sửa bảng, model, migration, query, repository, endpoint, upload file, RLS/Supabase policy, gặp N+1 hay query chậm, thiết kế hệ thống nhiều khách hàng dùng chung, gửi email/SMS nền, hoặc khi khách yêu cầu xem/xoá dữ liệu cá nhân, 'Nghị định 13', 'luật bảo vệ dữ liệu'."
---

# Backend: dữ liệu, ORM, multi-tenant, API

Thư mục skill: `${CLAUDE_SKILL_DIR}`. Chọn đúng phần cần cho việc đang làm, chỉ đọc file đó:

| Việc | Đọc |
|---|---|
| Thiết kế bảng, kiểu dữ liệu, ràng buộc, index, transaction, phân trang, migration, lưu file | `references/data-layer.md` |
| Viết code qua ORM: N+1, transaction, raw SQL, migration tool, connection pool | `references/orm.md` |
| Nhiều khách hàng dùng chung hệ thống (SaaS, workspace của khách) | `references/multi-tenant.md`, rồi `postgres-rls.md` và `isolation-tests.md` khi tới phần đó |
| API giữa BE và FE, hoặc đổi một API đang chạy | `references/api-contract.md` và `api-conventions.md` (có app mobile/desktop: mục 8, client sống lâu) |
| Đăng nhập, phiên, phân quyền theo vai trò, API key, webhook | `references/auth.md` |
| Job nền: gửi email/SMS, việc theo lịch, retry, dead letter | `references/jobs.md` |
| Upload file, server tải URL do người dùng đưa (SSRF), rate limit, header bảo mật, quét secret và dependency | `references/app-security.md` |
| Dữ liệu cá nhân và nhạy cảm: đồng ý, yêu cầu xuất/xoá, lộ dữ liệu, chuyển ra nước ngoài, luật Việt Nam | `references/privacy.md` |
| Query chậm, kiểm tải, mục tiêu hiệu năng | `${CLAUDE_SKILL_DIR}/../ship/references/performance.md` |

Trước khi dùng API của một ORM hay thư viện mà bạn không chắc ở version đang cài, kiểm version và tài liệu (`${CLAUDE_SKILL_DIR}/../plan/references/tech-research.md`). ORM đổi API giữa các bản major khá thường xuyên.

**Cân đúng mức.** Chỉ đọc file khớp với việc: sửa một query không cần đọc phần multi-tenant; hệ thống một khách hàng thì bỏ qua phần tenant. Ví dụ SQL viết cho PostgreSQL: dự án dùng MySQL, SQLite hay MongoDB thì giữ nguyên tắc, tìm cách làm tương đương trong tài liệu của DB đó (vd MySQL không có RLS: lọc tenant ở repository và test cô lập kỹ hơn), không chép nguyên cú pháp Postgres.

## Quy tắc luôn áp dụng

Những lỗi dưới đây đắt nhất và hay gặp nhất, nên nhớ cả khi chưa đọc file chi tiết nào:

1. **Bất biến nằm ở DB**, không chỉ ở code: NOT NULL, FK, UNIQUE, CHECK. Code có thể có bug; constraint thì không.
2. **Tiền** là số nguyên theo đơn vị nhỏ nhất (VND không có số lẻ) hoặc `numeric`, không dùng float. **Thời gian** là `timestamptz`, lưu UTC.
3. **Cột FK cần index** (Postgres không tự tạo). Index theo đúng cách query (cột so bằng trước, cột sort/range sau).
4. **Không gọi API bên ngoài bên trong transaction DB**: transaction giữ connection và khoá trong lúc chờ mạng.
5. **Danh sách luôn phân trang** và có giới hạn; bảng lớn thì dùng phân trang theo con trỏ (keyset), không dùng offset.
6. **Đọc SQL mà ORM sinh ra** cho mỗi migration trước khi chạy; không sửa migration đã chạy ở môi trường khác; migration trên bảng lớn phải an toàn khi bảng đang có dữ liệu và đang được dùng.
7. **Hệ thống nhiều khách hàng**: tenant nằm trong path của API (`/v1/t/{tenantId}/...`) và server kiểm user là thành viên ở mỗi request; không lấy tenant từ body/query, không dựa vào "tenant hiện tại" ngầm trong phiên. Mọi bảng thuộc tenant có `tenant_id`. Chi tiết đọc `multi-tenant.md`, đừng tự chế.
8. **API**: chốt contract trước khi BE và FE làm song song; tài nguyên của tenant khác trả 404.
9. **Gọi ra ngoài và việc chậm đi qua job nền**, xếp job trong cùng transaction với dữ liệu; job idempotent và mang `tenant_id` (`jobs.md`).
10. **Dữ liệu cá nhân**: chỉ thu trường cần, đồng ý theo từng mục đích, dữ liệu sức khoẻ, vị trí, tài chính là nhạy cảm (`privacy.md`).

## Trước khi coi là xong

- Test chạy với **DB thật** (container hoặc DB test), không mock tầng DB cho phần query, migration, RLS.
- Query mới trên bảng có thể lớn: xem `EXPLAIN (ANALYZE, BUFFERS)` với dữ liệu đủ nhiều.
- Endpoint chạm dữ liệu tenant: có test cô lập (tenant A chạm tài nguyên của B → 404).
- Migration: chạy được trên DB trống **và** trên DB có dữ liệu mẫu.
