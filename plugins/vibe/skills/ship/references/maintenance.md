# Bảo trì định kỳ

Phần mềm không hỏng vì một lần deploy lớn mà vì những việc nhỏ bị bỏ qua lâu ngày: thư viện cũ có lỗ hổng, chứng chỉ hết hạn, đĩa đầy, dữ liệu rác phình to.

## Mục lục
1. Dependency
2. Vá bảo mật
3. Runtime và hạ tầng
4. Dữ liệu
5. Chi phí
6. Lịch định kỳ

## 1. Dependency

- Bật Renovate hoặc Dependabot: gom bản patch/minor thành PR hằng tuần, CI tự chạy.
- Bản major nâng riêng từng gói: đọc migration guide trước (skill `plan`; từ file này: `../../plan/references/tech-research.md`), làm thành task card có test.
- Lockfile luôn được commit; CI cài bằng chế độ frozen (`pnpm install --frozen-lockfile`, `npm ci`).
- Gói không còn được bảo trì: lên kế hoạch thay thế trước khi nó gây sự cố.

## 2. Vá bảo mật

- Quét lỗ hổng trong CI (`pnpm audit`, `npm audit`, `pip-audit`, OSV-Scanner) và bật cảnh báo bảo mật của GitHub.
- Ưu tiên theo mức độ và việc lỗ hổng có thực sự chạm tới code của mình không; lỗ hổng nghiêm trọng ở phần đang dùng thì vá trong ngày theo quy trình hotfix.
- Rà quyền định kỳ: ai có quyền production, khoá API nào còn dùng; xoay vòng secret quan trọng theo lịch và ngay khi có người rời team.

## 3. Runtime và hạ tầng

- Theo dõi lịch hết hỗ trợ (EOL) của Node/Python, Postgres, image hệ điều hành; nâng trước khi hết hạn, thử trên staging trước.
- Postgres: nâng major có kế hoạch (thử restore và chạy test trên version mới), theo dõi bloat và autovacuum ở bảng lớn.
- Chứng chỉ SSL, tên miền: tự gia hạn và có cảnh báo trước khi hết hạn.

## 4. Dữ liệu

- Chính sách lưu giữ: log, bản ghi audit, session, file tạm, dữ liệu của tenant đã huỷ. Job dọn chạy theo lô, có giới hạn, có log.
- Xoá tenant theo yêu cầu: quy trình có xác nhận, xuất dữ liệu cho khách trước nếu cần, xoá DB + file + cache + bản sao trong search/analytics; ghi rõ thời gian dữ liệu còn tồn tại trong backup.
- Theo dõi tăng trưởng dung lượng theo bảng và theo tenant.

## 5. Chi phí

Xem hoá đơn hạ tầng hằng tháng: DB quá cỡ, log giữ quá lâu, bucket không có quy tắc vòng đời, môi trường preview bị bỏ quên. Gắn chi phí với tenant khi có thể, để biết khách nào lỗ.

## 6. Lịch định kỳ

| Tần suất | Việc |
|---|---|
| Hằng tuần | Merge PR cập nhật dependency, xem lỗi mới trong error tracking, xem cảnh báo bảo mật |
| Hằng tháng | Diễn tập restore, rà cảnh báo bị bỏ qua hoặc kêu sai, xem chi phí, xem dung lượng DB |
| Hằng quý | Nâng bản major cần thiết, rà quyền truy cập và secret, xem lịch EOL, rà runbook |

Mỗi việc định kỳ là một task card lặp lại, hoặc một lời nhắc trong lịch của team.
