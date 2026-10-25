# Tầng dữ liệu: schema, index, transaction, migration, lưu file

Ví dụ dùng PostgreSQL; nguyên tắc áp dụng cho MySQL/SQL Server với cú pháp tương ứng. Phần multi-tenant xem `multi-tenant.md`.

## Mục lục
1. Kiểu dữ liệu
2. Ràng buộc và quan hệ
3. Cột chuẩn, xoá mềm, lịch sử
4. Index
5. Query và phân trang
6. Transaction và tranh chấp
7. Migration an toàn
8. Lưu file và object storage

## 1. Kiểu dữ liệu

| Dữ liệu | Dùng | Tránh |
|---|---|---|
| ID | `uuid` (`uuidv7()` có sẵn từ Postgres 18; bản cũ dùng `gen_random_uuid()` hoặc sinh UUIDv7 ở app) hoặc `bigint generated always as identity` cho bảng nội bộ | lộ ID tự tăng ra API |
| Tiền | `bigint` theo đơn vị nhỏ nhất + cột mã tiền tệ, hoặc `numeric(15,2)` cho tiền có số lẻ | `float`, `real`, `double` |
| Thời điểm | `timestamptz` (lưu UTC) | `timestamp` không múi giờ cho thời điểm thật |
| Ngày thuần (sinh nhật, ngày lễ) | `date` | lưu thành timestamp nửa đêm |
| Chuỗi | `text` + CHECK độ dài nếu cần | `varchar(255)` theo thói quen |
| Trạng thái | `text` + CHECK (giá trị cố định, hay thay đổi theo code) hoặc bảng tra cứu (khi admin cần thêm giá trị) | số nguyên "1, 2, 3" không ai nhớ nghĩa |
| Dữ liệu linh hoạt | `jsonb` cho thuộc tính tuỳ biến, payload webhook | `jsonb` cho dữ liệu cần lọc, join, ràng buộc thường xuyên |
| Số điện thoại, mã số | `text` (giữ số 0 đầu, dấu +) | kiểu số |

## 2. Ràng buộc và quan hệ

- `NOT NULL` là mặc định; cột nào được rỗng phải có lý do nghiệp vụ.
- FK luôn ghi rõ `ON DELETE` (`RESTRICT` là mặc định an toàn; `CASCADE` chỉ cho dữ liệu thuộc hẳn về cha, vd dòng của đơn hàng).
- `UNIQUE` cho mọi thứ nghiệp vụ coi là duy nhất (email trong một tổ chức, mã đơn). Thiếu UNIQUE thì hai request đồng thời sẽ tạo ra bản trùng, dù code đã "kiểm trước khi insert".
- `CHECK` cho khoảng giá trị và trạng thái (`amount >= 0`, `status IN (...)`, `end_at > start_at`).
- Quan hệ nhiều-nhiều qua bảng nối có khoá chính kép và cột riêng của quan hệ (vai trò, ngày tham gia).

## 3. Cột chuẩn, xoá mềm, lịch sử

- `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at` (cập nhật bằng trigger hoặc ORM).
- **Xoá mềm** (`deleted_at`) có giá: mọi query phải nhớ lọc, và UNIQUE phải thành partial index (`... WHERE deleted_at IS NULL`). Nhiều khi một trạng thái `archived` rõ nghĩa hơn. Dữ liệu cá nhân mà khách yêu cầu xoá thì phải xoá thật hoặc ẩn danh hoá.
- **Lịch sử thay đổi** (ai sửa gì, lúc nào) cho dữ liệu nhạy cảm: bảng `audit_log` (actor, action, entity, entity_id, diff jsonb, at) ghi trong cùng transaction.

## 4. Index

- Index cho mọi cột FK và mọi cột hay dùng để lọc hoặc sắp xếp trong query thật.
- Index nhiều cột: cột so sánh bằng (`=`) trước, cột khoảng hoặc sắp xếp sau, vd `(tenant_id, status, created_at DESC)`.
- Partial index cho tập con hay query (`WHERE status = 'pending'`), unique partial cho xoá mềm.
- Kiểm bằng `EXPLAIN (ANALYZE, BUFFERS)` trên dữ liệu đủ lớn; đừng đoán. Mỗi index làm chậm thao tác ghi, nên index không được query nào dùng thì xoá.

## 5. Query và phân trang

- Không `SELECT *` trong code sản phẩm: chọn cột cần dùng.
- **N+1** (query trong vòng lặp) là lỗi hiệu năng phổ biến nhất với ORM; cách sửa theo từng ORM ở `orm.md`.
- Phân trang theo con trỏ (keyset): `WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT 20`, kèm index `(created_at DESC, id DESC)`. Offset lớn thì chậm, và còn trùng hoặc sót dòng khi dữ liệu thay đổi giữa các trang. Giá trị trong cursor phải giữ đủ độ chính xác của DB: `timestamptz` có micro giây, còn `Date` của JavaScript chỉ có mili giây, nên lấy giá trị dạng text từ DB (vd `created_at::text`) hoặc dùng cột id tăng dần làm khoá sắp xếp, nếu không sẽ trùng hoặc sót dòng giữa các trang.
- Thao tác hàng loạt: batch theo lô (500–5000 dòng), không một câu cập nhật cả triệu dòng.

## 6. Transaction và tranh chấp

- Một transaction bọc đúng một đơn vị nghiệp vụ (tạo đơn + trừ kho + ghi audit), ngắn nhất có thể.
- Tranh chấp tài nguyên (slot lịch hẹn, tồn kho, số dư): dùng ràng buộc DB (UNIQUE, CHECK `stock >= 0`), hoặc `SELECT ... FOR UPDATE`, hoặc câu cập nhật có điều kiện (`UPDATE ... SET stock = stock - 1 WHERE id = $1 AND stock > 0` rồi kiểm số dòng bị ảnh hưởng).
- Sửa cùng bản ghi từ nhiều người (form sửa): optimistic locking bằng cột `version`, cập nhật kèm `WHERE version = $old`.
- Side effect ra ngoài (gửi mail, gọi cổng thanh toán, webhook): ghi vào bảng outbox trong cùng transaction, worker gửi sau; hoặc gọi sau khi commit, kèm idempotency key.
- Deadlock: luôn khoá các dòng theo cùng một thứ tự (vd theo id tăng dần).

## 7. Migration an toàn

- **Expand → migrate → contract**: thêm cột/bảng mới (tương thích ngược) → deploy code ghi cả hai → backfill theo lô → chuyển đọc sang cái mới, bỏ `NOT NULL` của cột cũ → thôi ghi và bỏ cột cũ khỏi model ORM → xoá cột cũ ở một release riêng sau cùng. Đổi tên cột "một phát" sẽ làm bản code đang chạy lỗi ngay lúc deploy. Bảng từng bước kèm khả năng rollback ở skill `ship`, file `references/release-rollback.md` mục 2 (từ file này: `../../ship/references/release-rollback.md`).
- Đầu migration đặt `SET lock_timeout = '5s'`: ALTER chờ khoá sẽ chặn cả hàng query phía sau, nên fail sớm rồi chạy lại an toàn hơn.
- `CREATE INDEX CONCURRENTLY` cho bảng lớn (không chạy trong transaction, phải tắt transaction của tool cho migration đó).
- FK hoặc CHECK mới trên bảng có dữ liệu: `NOT VALID`, rồi `VALIDATE CONSTRAINT` ở bước riêng. `NOT NULL`: CHECK `NOT VALID` → `VALIDATE` → `SET NOT NULL` → xoá CHECK phụ.
- Backfill: theo lô, có thể chạy lại (idempotent), kiểm số dòng bị ảnh hưởng. Bảng có RLS `FORCE` thì đọc `postgres-rls.md` mục 5 trước, vì backfill có thể âm thầm cập nhật 0 dòng.
- Không sửa migration đã chạy ở môi trường dùng chung; cần đổi thì viết migration mới.
- Mỗi lúc chỉ một task tạo migration, để thứ tự không bị trùng.

## 8. Lưu file và object storage

- File (ảnh, PDF, chứng từ) để ở object storage (S3, R2, GCS, Supabase Storage); DB chỉ lưu metadata: key, tên gốc, MIME, kích thước, checksum, người tải lên, `tenant_id`.
- Upload trực tiếp từ trình duyệt bằng **presigned URL** có hạn ngắn, giới hạn kích thước và loại file; server tạo URL sau khi kiểm quyền.
- Key do server sinh (`tenants/{tenant_id}/customers/{id}/{uuid}.pdf`), không dùng tên file người dùng đặt.
- Bucket mặc định private; tải xuống bằng presigned GET sau khi kiểm quyền. File công khai (ảnh sản phẩm) để bucket hoặc prefix riêng.
- Kiểm loại file thật (magic bytes), quét virus nếu là file người dùng chia sẻ cho nhau; không phục vụ file upload như HTML cùng domain với app.
- Xoá bản ghi thì có job dọn file tương ứng; bật versioning cho dữ liệu quan trọng.
