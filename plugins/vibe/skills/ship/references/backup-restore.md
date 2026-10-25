# Backup và khôi phục

Backup chưa từng restore thử chỉ là hy vọng. Thiết kế ngược từ câu hỏi: "Nếu mất DB lúc 3 giờ chiều nay, chấp nhận mất bao nhiêu dữ liệu và chờ bao lâu?"

## Mục lục
1. RPO và RTO
2. Postgres: các lớp backup
3. Lệnh cơ bản
4. Bảng có RLS FORCE
5. Khôi phục và diễn tập restore
6. Khôi phục một phần và theo tenant
7. File và object storage
8. Bảo mật và lưu giữ

## 1. RPO và RTO

- **RPO**: chấp nhận mất tối đa bao nhiêu dữ liệu (vd 5 phút).
- **RTO**: chấp nhận ngừng dịch vụ tối đa bao lâu (vd 1 giờ).
- Ghi hai con số này vào ARCHITECTURE.md. Chúng quyết định cần PITR hay chỉ dump hằng ngày, có cần bản sao ở vùng khác không.

## 2. Postgres: các lớp backup

| Lớp | Giải quyết | Ghi chú |
|---|---|---|
| Backup tự động + PITR của DB managed (RDS, Cloud SQL, Neon, Supabase...) | Khôi phục về một thời điểm bất kỳ trong khoảng giữ lại; RPO vài phút | Bật ngay từ đầu, kiểm khoảng thời gian giữ lại theo gói đang dùng |
| Dump logic định kỳ (`pg_dump`) ra storage khác (tài khoản, vùng khác) | Mất cả tài khoản/nhà cung cấp, xoá nhầm DB, cần dữ liệu cũ hơn khoảng PITR | Theo nguyên tắc 3-2-1: 3 bản, 2 loại lưu trữ, 1 bản ở nơi khác |
| Bản sao đọc (replica) | Tính sẵn sàng | **Không phải backup**: lệnh xoá nhầm cũng được sao chép sang replica |

Tự quản lý Postgres (VPS) thì dùng công cụ backup có WAL archiving và PITR (vd pgBackRest, WAL-G) thay vì chỉ cron `pg_dump`.

## 3. Lệnh cơ bản

`pg_dump` chỉ chứa một database, **không chứa role**. Restore sang máy chủ mới mà thiếu role thì quyền sở hữu, GRANT và policy theo role đều hỏng. Vì vậy backup cả hai:

```bash
# 1. Role (không kèm mật khẩu; DB managed thường không cho đọc mật khẩu)
pg_dumpall --roles-only --no-role-passwords --file=roles-$(date +%F).sql --dbname="$ADMIN_URL"

# 2. Database, định dạng custom (nén, restore chọn lọc được), GIỮ thông tin owner
pg_dump --format=custom --file=app-$(date +%F).dump "$BACKUP_DATABASE_URL"

# Xem nội dung bản dump
pg_restore --list app-2026-10-25.dump | head
```

- `BACKUP_DATABASE_URL` dùng role backup riêng: `BYPASSRLS` + `pg_read_all_data` (mục 4). Role chỉ được GRANT trên từng bảng sẽ làm `pg_dump` lỗi `permission denied` ngay khi có bảng mới.
- Mã hoá file trước khi đưa lên storage, giới hạn người được tải về.

## 4. Bảng có RLS FORCE

Bảng bật `FORCE ROW LEVEL SECURITY` áp policy lên cả owner, nên `pg_dump` bằng role owner sẽ lỗi `query would be affected by row-level security policy`. Dump bằng role backup có `BYPASSRLS` và `pg_read_all_data` (vd `app_backup`, skill `backend` file `references/postgres-rls.md` mục 1; từ file này: `../../backend/references/postgres-rls.md`).

## 5. Khôi phục và diễn tập restore

**Restore phải giữ đúng owner.** Restore bằng `--no-owner`, mọi bảng sẽ thuộc về user đang restore: migration sau đó bằng role owner cũ lỗi "must be owner", còn user restore trở thành owner nên bị `FORCE` lọc hết dòng. Quy trình:

1. Máy chủ mới thì tạo role trước: chạy `roles-*.sql` (bỏ qua các dòng báo role đã tồn tại), đặt lại mật khẩu cho role đăng nhập.
2. Tạo database đích **cùng owner với database gốc**, để schema `public` thuộc đúng role:
   ```sql
   CREATE DATABASE restore_check OWNER app_owner;
   ```
3. Restore bằng superuser (máy chủ tự quản), hoặc trên DB managed bằng user admin **là thành viên** của các role sở hữu object (`GRANT app_owner TO <admin>`), **không** dùng `--no-owner`:
   ```bash
   pg_restore --dbname="$RESTORE_URL" app-2026-10-25.dump
   ```
   Đọc kỹ cảnh báo cuối lệnh: `errors ignored on restore: N` với N khác 0 thì restore chưa đạt, xem từng lỗi.
4. Kiểm sau restore:
   - Owner của bảng và function đúng như bản gốc (`\dt+`, `\df+`, hoặc truy vấn `pg_tables`, `pg_proc`).
   - Các câu kiểm tra RLS ở `postgres-rls.md` mục 8 trả rỗng (mọi bảng có `tenant_id` vẫn bật RLS + `FORCE`, role app không bypass).
   - Đếm dòng các bảng chính bằng role backup, so với bản gốc tại thời điểm tương ứng.
   - Chạy app trỏ vào DB vừa restore, đăng nhập bằng một tài khoản thử, mở vài màn hình chính.

**Diễn tập** tối thiểu mỗi tháng (và sau mỗi thay đổi lớn về hạ tầng): làm đủ 4 bước trên với bản backup mới nhất (hoặc PITR về một thời điểm) vào môi trường riêng, ghi thời gian thực tế so với RTO vào `docs/ops/restore-drills.md`. Lâu hơn RTO hoặc có bước fail thì phải có task card sửa ngay.

## 6. Khôi phục một phần và theo tenant

Sự cố thường gặp không phải mất cả DB mà là xoá hoặc sửa nhầm dữ liệu của một tenant:

- Restore bản backup (hoặc PITR về trước thời điểm lỗi) vào DB tạm.
- Lấy đúng phần cần thiết (`WHERE tenant_id = ...`, đúng bảng) và chép về production bằng script có review, trong transaction, kiểm số dòng trước và sau.
- Đừng restore đè cả production chỉ vì một tenant: sẽ mất dữ liệu mới của mọi tenant khác.
- Nên có sẵn script xuất và nhập dữ liệu theo tenant: vừa phục vụ khôi phục, vừa đáp ứng yêu cầu xuất dữ liệu của khách.

## 7. File và object storage

- Bật versioning cho bucket chứa file người dùng, kèm quy tắc vòng đời (xoá bản cũ sau N ngày).
- Sao chép sang vùng hoặc tài khoản khác nếu RPO/RTO yêu cầu.
- Backup DB và file phải khớp nhau về thời điểm ở mức chấp nhận được (metadata trong DB trỏ tới file còn tồn tại).

## 8. Bảo mật và lưu giữ

- Backup chứa toàn bộ dữ liệu khách hàng: mã hoá, phân quyền chặt, ghi log truy cập.
- Thời gian lưu giữ theo nhu cầu nghiệp vụ và quy định bảo vệ dữ liệu cá nhân; dữ liệu khách đã yêu cầu xoá vẫn còn trong backup cũ cho tới khi backup đó hết hạn, nên ghi rõ điều này trong chính sách.
- Theo dõi backup: job backup lỗi phải có cảnh báo (`observability.md`).
