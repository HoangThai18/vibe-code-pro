# Release vX.Y.Z

_Ngày dự kiến: YYYY-MM-DD HH:mm · Người phụ trách: ... · Người trực sau release: ..._

## Nội dung
- Task/phase: ...
- Thay đổi DB: không có / có (liệt kê migration, thời gian chạy trên staging)
- Feature flag: tên flag, mặc định, kế hoạch bật (nội bộ → tenant thử → toàn bộ)

## Checklist trước release
- [ ] Review PASS (docs/reviews/...)
- [ ] CI xanh, E2E chạy trên staging
- [ ] Migration đã chạy thử trên staging, tương thích ngược với bản đang chạy
- [ ] Backup gần nhất thành công lúc: ...
- [ ] Dashboard và cảnh báo cho thay đổi này đã có
- [ ] Thông báo người dùng (nếu có thay đổi lớn hoặc bảo trì)

## Kế hoạch rollback
- Dấu hiệu rollback: vd tỉ lệ lỗi gấp 3 lần bình thường trong 10 phút, luồng thanh toán lỗi
- Người quyết định: ...
- Cách 1: tắt flag ...
- Cách 2: deploy lại artifact vA.B.C (commit ...)
- Dữ liệu: migration có tương thích để rollback code không? Nếu không, kế hoạch sửa tiến là gì?

## Sau release
- [ ] Smoke test pass
- [ ] Theo dõi dashboard 30 phút: ổn / có vấn đề (ghi lại)
- [ ] Release note gửi người dùng
