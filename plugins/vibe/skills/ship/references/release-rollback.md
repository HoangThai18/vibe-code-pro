# Release, feature flag và rollback

## Mục lục
1. Checklist trước release
2. Thứ tự deploy khi có thay đổi DB
3. Feature flag
4. Rollback
5. Hotfix
6. Version, changelog, release note

## 1. Checklist trước release

Ghi vào `docs/releases/<version>.md` theo `templates/RELEASE.md`:

- Review của phase/task đã PASS; CI xanh; E2E chạy trên staging.
- Migration đã chạy thử trên staging với dữ liệu cỡ gần thật; biết thời gian chạy và lock của nó.
- Backup gần nhất thành công (và đã từng restore thử).
- Feature flag của tính năng mới mặc định tắt (nếu có).
- Dashboard và cảnh báo cho tính năng mới đã có.
- Kế hoạch rollback viết sẵn: dấu hiệu nào thì rollback, ai quyết, các bước.
- Người trực sau release, kênh báo sự cố, thông báo cho người dùng nếu có thay đổi lớn hoặc bảo trì.

## 2. Thứ tự deploy khi có thay đổi DB

Ví dụ đổi tên cột `customer_name` (đang `NOT NULL`) thành `full_name`, không có lúc nào hệ thống lỗi:

| Release | Migration | Code | Rollback về bản trước |
|---|---|---|---|
| R1 (expand) | Thêm cột `full_name` (nullable) | Ghi **cả hai** cột, vẫn đọc cột cũ | Được: bản cũ không biết cột mới |
| (job) | Backfill `full_name` từ `customer_name` theo lô, kiểm số dòng còn NULL = 0 | | Không ảnh hưởng |
| R2 | `full_name` thành `NOT NULL` (cách an toàn ở data-layer mục 7); **bỏ `NOT NULL` của `customer_name`** để bản sau thôi ghi được | Đọc `full_name`, vẫn ghi cả hai | Được về R1: R1 ghi cả hai cột |
| R3 | Không có | Thôi ghi và **bỏ `customer_name` khỏi model của ORM** (Prisma schema, `ignored_columns` của Rails...) để ORM không còn select hay insert cột đó | Được về R2: cột cũ vẫn còn, chỉ thiếu dữ liệu mới ghi trong lúc R3 chạy; nếu cần thì backfill ngược từ `full_name` |
| R4 (contract) | `DROP COLUMN customer_name`, khi R3 đã chạy ổn định | Không đổi | Chỉ về được R3 (R3 không còn biết cột cũ); muốn về R2 thì phải thêm lại cột |

Ba lỗi hay gặp với kiểu thay đổi này:
- Thôi ghi cột cũ khi cột đó vẫn `NOT NULL`: mọi lệnh insert lỗi ngay lúc deploy.
- Xoá cột trong khi bản code đang chạy (hoặc bản có thể phải rollback về) vẫn map cột đó trong ORM: mọi truy vấn của bản đó lỗi.
- Gộp nhiều bước vào một release để "đỡ mất công", làm mất khả năng rollback.

Nguyên tắc: mỗi release chỉ chứa thay đổi mà **bản code trước đó vẫn chạy được**. Xoá dữ liệu luôn là bước riêng, cuối cùng, khi chắc chắn không cần quay lại.

## 3. Feature flag

- Dùng cho tính năng rủi ro hoặc lớn: code được deploy nhưng tắt, bật khi sẵn sàng.
- Multi-tenant: bật theo tenant (nội bộ → vài tenant thân thiết → toàn bộ). Lỗi chỉ ảnh hưởng nhóm nhỏ.
- Bắt đầu đơn giản: bảng `feature_flags (key, tenant_id null = toàn hệ thống, enabled)` có cache ngắn; dùng dịch vụ chuyên dụng khi cần thử nghiệm A/B hoặc nhiều đội.
- Flag là nợ kỹ thuật: tính năng ổn định rồi thì xoá flag và nhánh code cũ (tạo task card dọn dẹp ngay khi bật 100%).

## 4. Rollback

Chọn cách nhanh và ít rủi ro nhất theo thứ tự:

1. **Tắt feature flag**: vài giây, không cần deploy.
2. **Deploy lại artifact trước đó**: được nếu migration của bản mới tương thích ngược (mục 2). Đây là lý do mỗi release phải tương thích ngược. **Không chạy migration** khi rollback: DB giữ nguyên version mới, bản code cũ chạy được trên đó; tool migration của bản cũ không biết các migration mới hơn và nhiều tool sẽ báo lỗi (workflow deploy mẫu có input `run_migrations: false` cho việc này, `ci-cd.md` mục 4).
3. **Sửa tiến (forward fix)**: khi rollback code không đủ, hoặc migration đã ghi dữ liệu kiểu mới. Hotfix nhỏ, review nhanh, deploy.
4. **Khôi phục dữ liệu từ backup**: biện pháp cuối, mất dữ liệu phát sinh sau thời điểm backup (trừ khi có PITR). Ưu tiên khôi phục vào DB riêng rồi chép phần cần thiết, thay vì ghi đè cả production (`backup-restore.md`).

Ghi chú về "down migration": sau khi bản mới đã ghi dữ liệu, chạy migration ngược thường làm mất dữ liệu đó. Đừng coi down migration là kế hoạch rollback chính; coi nó là công cụ cho môi trường dev.

Quyết định rollback dựa trên tiêu chí viết trước (vd tỉ lệ lỗi gấp 3 lần bình thường trong 10 phút, hoặc luồng thanh toán lỗi), không tranh luận lúc đang cháy.

## 5. Hotfix

- Tạo branch `hotfix/<mô-tả>` từ tag đang chạy trên production.
- Sửa tối thiểu kèm test tái hiện lỗi (skill `fix`), review nhanh nhưng vẫn review.
- Deploy theo đúng pipeline (không sửa tay trên server), rồi merge ngược vào `main` và các branch phase đang mở.

## 6. Version, changelog, release note

- Version theo semver (`v1.4.0`) hoặc theo ngày (`2026.10.25`); tag git trùng với artifact.
- Changelog sinh từ commit (có task ID) hoặc PR; release note viết cho người dùng: thay đổi gì, ảnh hưởng gì, có cần làm gì không.
