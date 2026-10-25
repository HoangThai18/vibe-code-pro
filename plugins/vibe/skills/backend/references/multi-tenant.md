# Multi-tenant DB: cô lập dữ liệu khách hàng ngay từ schema

Trong SaaS multi-tenant, sự cố đắt nhất không phải chậm hay sập mà là khách A nhìn thấy dữ liệu của khách B. Lỗi đó thường đến từ một câu query quên điều kiện tenant. Skill này đẩy việc cô lập xuống tầng database, để một lần quên không trở thành sự cố.

Ví dụ dùng PostgreSQL. Nguyên tắc vẫn đúng với DB khác, trừ phần RLS.

## 1. Chọn mô hình tenancy (khó đảo ngược, chốt sớm)

| Mô hình | Hợp khi | Cái giá |
|---|---|---|
| **Shared schema + `tenant_id` + RLS** (mặc định) | Nhiều tenant nhỏ và vừa, B2B SaaS phổ thông | Cần kỷ luật scope; bù lại bằng RLS + test |
| Schema-per-tenant | Vài chục đến vài trăm tenant, cần tuỳ biến riêng | Migration chạy N lần; pool và `search_path` phức tạp |
| Database-per-tenant | Enterprise, yêu cầu pháp lý, cần backup/restore riêng từng khách | Vận hành nặng, chi phí cao |

Có thể lai: tenant thường dùng chung, tenant enterprise tách DB riêng. Ghi quyết định và lý do vào `ARCHITECTURE.md`.

## 2. Quy tắc schema (shared schema)

1. Có bảng `tenants`. Bảng `users` là global, vì một người có thể thuộc nhiều tenant; quan hệ đi qua `memberships(tenant_id, user_id, role)`.
2. Mọi bảng thuộc tenant có `tenant_id uuid NOT NULL REFERENCES tenants(id)`. Tách rõ bảng global (gói cước, danh mục tỉnh thành...): không có `tenant_id`, tenant chỉ được đọc.
3. **Composite FK chống tham chiếu chéo tenant:**
   ```sql
   CREATE TABLE customers (
     id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id  uuid NOT NULL REFERENCES tenants(id),
     email      text,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (tenant_id, id),
     UNIQUE (tenant_id, email)
   );

   CREATE TABLE orders (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id   uuid NOT NULL REFERENCES tenants(id),
     customer_id uuid NOT NULL,
     FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id)
   );
   ```
   Với FK thường (`customer_id REFERENCES customers(id)`), một bug có thể gắn đơn của tenant A vào khách của tenant B mà DB vẫn nhận. Composite FK khiến DB từ chối.
4. **Unique theo tenant**: `UNIQUE (tenant_id, email)`, không phải `UNIQUE (email)`, trừ khi giá trị đó thật sự là global. Unique global còn làm lộ thông tin: tenant A thử email và nhận lỗi trùng nghĩa là tenant khác đang có email đó.
5. **Index bắt đầu bằng `tenant_id`**, theo đúng cách query: `(tenant_id, created_at DESC)`, `(tenant_id, status)`.
6. **ID**: UUID (`uuidv7()` có sẵn từ Postgres 18, bản cũ hơn dùng `gen_random_uuid()` hoặc sinh ở app). Không lộ ID tự tăng ra API.
7. **Xoá tenant và xuất dữ liệu**: thiết kế từ đầu (chiến lược `ON DELETE`, job xoá theo lô), vì sớm muộn khách cũng yêu cầu.

## 3. Row Level Security: lưới an toàn ở tầng DB

Bật RLS cho mọi bảng thuộc tenant, policy đọc tenant hiện tại từ một biến trong transaction. SQL mẫu, cách set context theo từng ORM (pg, Prisma, Drizzle, SQLAlchemy, Django), Supabase, và danh sách bẫy nằm ở [postgres-rls.md](postgres-rls.md). Đọc file đó trước khi viết migration RLS đầu tiên của dự án.

Bốn điều không được sai:

- **App kết nối bằng role thường**: không superuser, không `BYPASSRLS`, không phải owner của bảng (hoặc bảng có `FORCE ROW LEVEL SECURITY`). Superuser bỏ qua RLS, nên test chạy bằng superuser sẽ pass dù RLS không hoạt động.
- **Set tenant theo transaction** (`set_config('app.tenant_id', $1, true)`), không theo session. Dùng connection pool mà set theo session thì tenant của request trước sẽ rò sang request sau trên cùng connection.
- **Thiếu tenant context thì không thấy dòng nào** (fail closed), không phải thấy tất cả.
- **Không thêm `OR ...` vào policy `FOR ALL`**: nhánh `OR` mở cả quyền sửa và xoá, không chỉ quyền đọc. Bảng `memberships` và `tenants` cần đọc theo user lúc đăng nhập thì tách policy đọc và ghi (postgres-rls.md mục 3).

## 4. Ngoài database

Tenant phải đi theo dữ liệu ở mọi nơi:

- Server lấy tenant từ path của request (`/v1/t/{tenantId}/...`) và kiểm user trong phiên là thành viên của tenant đó ở mỗi request (không phải → 404); không tin `tenant_id` trong body/query (api-conventions.md mục 5).
- Job / queue: payload mang `tenant_id`; worker set tenant context trước khi chạm DB; cron duyệt từng tenant một cách tường minh.
- Cache key `t:{tenant_id}:...`; object storage prefix `tenants/{tenant_id}/`; search index, analytics, log đều có field `tenant_id`.
- Admin/support cần xem chéo tenant: role và đường code riêng, có audit log. Không "tắt RLS cho nhanh".
- Noisy neighbor: rate limit và quota theo tenant, `statement_timeout` cho role app.

## 5. Migration an toàn

- **Expand → migrate → contract**: thêm cột nullable, backfill theo lô, thêm ràng buộc, chỉ bỏ cái cũ sau khi code mới chạy ổn.
- **Backfill khi bảng có `FORCE`**: chạy bằng role owner mà không có tenant context thì cập nhật 0 dòng và không báo lỗi; `pg_dump` bằng owner cũng bị lỗi. Chạy backfill/backup bằng role maintenance có BYPASSRLS (hoặc lặp từng tenant với `set_config`), và kiểm số dòng bị ảnh hưởng trước khi sang bước contract (postgres-rls.md mục 5). Bỏ qua bước này thì bước xoá cột cũ sẽ xoá luôn dữ liệu chưa được chuyển.
- Đặt `SET lock_timeout = '5s'` ở đầu migration: ALTER đang chờ khoá sẽ chặn mọi query xếp hàng phía sau nó, nên thà fail sớm rồi chạy lại còn hơn treo cả hệ thống.
- Thêm `NOT NULL` cho bảng lớn: `ADD CONSTRAINT ... CHECK (col IS NOT NULL) NOT VALID`, rồi `VALIDATE CONSTRAINT`, rồi `SET NOT NULL` (Postgres 12+ bỏ qua bước quét bảng khi đã có CHECK hợp lệ), sau đó xoá CHECK phụ.
- FK mới trên bảng đã có dữ liệu: `NOT VALID` rồi `VALIDATE CONSTRAINT` ở bước riêng.
- Index cho bảng lớn: `CREATE INDEX CONCURRENTLY`. Lệnh này không chạy được trong transaction, nên migration đó phải tắt transaction của tool migration.
- Bảng mới thuộc tenant: tạo bảng, bật RLS, `FORCE`, policy, index trong cùng một migration, để không có lúc nào bảng tồn tại mà chưa có RLS.
- Mỗi lúc chỉ một task/agent tạo migration (khai `touches: [.../migrations/**]`), để thứ tự migration không bị trùng.

## 6. Test cô lập tenant

Bắt buộc cho mọi endpoint chạm dữ liệu tenant. Tạo 2 tenant A, B có dữ liệu. Đăng nhập A rồi thử đọc / sửa / xoá tài nguyên của B bằng id: phải 404. Danh sách của A không chứa dữ liệu của B. `tenant_id` gửi từ client bị bỏ qua. Test RLS trực tiếp ở DB bằng role app; không set context thì ra 0 dòng. Mẫu test (dạng bảng, tự phủ route mới) ở [isolation-tests.md](isolation-tests.md).

## Khi review một schema có sẵn

Đi lần lượt: bảng nào thuộc tenant mà thiếu `tenant_id`? FK nào chưa composite? Unique/index nào thiếu `tenant_id`? RLS đã bật và `FORCE` chưa, role app có bypass không? Policy `FOR ALL` nào có nhánh `OR`? Context set theo session hay theo transaction? Backfill/backup chạy bằng role nào? Job, cache, storage đã mang tenant chưa? Có test cô lập chưa?

Báo cáo theo mức: **Nguy hiểm** (có thể rò dữ liệu) → **Nên sửa** → **Gợi ý**. Mỗi mục kèm migration sửa an toàn theo mục 5.
