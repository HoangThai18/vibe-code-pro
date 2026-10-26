---
name: ship
description: "Đưa phần mềm lên chạy thật và vận hành: CI/CD, môi trường, deploy kèm migration đúng thứ tự, feature flag, checklist release, rollback; sau khi chạy thật thì log, metric, cảnh báo, error tracking, backup và khôi phục (RPO/RTO, PITR, diễn tập restore), bảo trì dependency và vá bảo mật. Dùng khi user nói 'deploy', 'release', 'go-live', 'lên production', 'CI/CD', 'GitHub Actions', 'rollback', 'feature flag', 'monitoring', 'alert', 'Sentry', 'backup', 'restore', 'nâng cấp thư viện', 'vá lỗ hổng'."
---

# Ship: đưa lên chạy thật và giữ nó chạy

Thư mục skill: `${CLAUDE_SKILL_DIR}`. Chỉ đọc phần cần cho việc đang làm:

| Việc | Đọc |
|---|---|
| Dựng pipeline CI/CD, môi trường, secret | `references/ci-cd.md` |
| Chuẩn bị release, thứ tự deploy khi có migration, feature flag, rollback | `references/release-rollback.md` + `templates/RELEASE.md` |
| Log, metric, cảnh báo, error tracking, healthcheck | `references/observability.md` |
| Backup, khôi phục, diễn tập restore, xuất dữ liệu theo tenant | `references/backup-restore.md` |
| Nâng cấp dependency, vá bảo mật, dọn dữ liệu, việc định kỳ | `references/maintenance.md` |
| Phát hành app mobile: build, ký, store, OTA, phát hành dần, buộc cập nhật | `${CLAUDE_SKILL_DIR}/../mobile/references/release.md` |
| Phát hành app desktop: đóng gói, ký số, notarize, tự cập nhật | `${CLAUDE_SKILL_DIR}/../desktop/references/release.md` |

Nền tảng deploy (Vercel, Fly, Railway, Render, AWS, GCP, VPS + Docker...) thay đổi cấu hình thường xuyên: đọc tài liệu hiện hành của nền tảng mà dự án dùng (`${CLAUDE_SKILL_DIR}/../plan/references/tech-research.md`) trước khi viết cấu hình.

**Cân đúng mức.** Dự án thử nghiệm hoặc chưa có người dùng thật không cần đủ bộ: CI chạy test, deploy được, backup tự động của DB managed là đủ cho tới trước go-live. Một câu hỏi lẻ (vd "viết workflow chạy test") thì làm đúng việc đó, không dựng thêm phần không được hỏi. Mọi thao tác chạm production (deploy, migration, rollback, restore) vẫn hỏi user trước.

## Quy tắc luôn áp dụng

1. **Không có secret trong repo**. Secret nằm trong secret manager hoặc biến môi trường của nền tảng; repo chỉ có `.env.example`.
2. **Mỗi bản deploy là một artifact bất biến** (image hoặc build có version, gắn commit SHA). Rollback code là deploy lại artifact cũ, không build lại từ source. App mobile, desktop đã cài thì **không rollback được**: phát hành dần, tắt bằng feature flag phía server, sửa bằng bản mới hơn.
3. **Migration tương thích ngược với bản code đang chạy** (expand → contract). Nhờ vậy rollback code luôn làm được. Thay đổi phá vỡ thì tách ra nhiều release.
4. **Có kế hoạch rollback trước khi deploy**, ghi trong `RELEASE.md`: tiêu chí quyết định rollback, ai quyết, rollback bằng cách nào.
5. **Tính năng rủi ro đi sau feature flag**, bật dần (nội bộ → vài tenant thử → toàn bộ). Tắt flag là cách rollback nhanh nhất.
6. **Backup chỉ có giá trị khi đã restore thử thành công.**
7. **Cảnh báo theo triệu chứng người dùng thấy** (lỗi tăng, chậm), kèm hướng dẫn xử lý; đừng cảnh báo mọi thứ.
8. **Production là nơi có dữ liệu thật**: không chạy lệnh ghi, migration hay script dọn dữ liệu trên production mà chưa có user xác nhận và chưa có backup gần nhất.

## Thứ tự gợi ý cho một dự án mới

P0: CI trên mỗi PR + deploy tự động lên staging + healthcheck + error tracking + backup tự động của DB. Trước khi có người dùng thật: cảnh báo cơ bản, diễn tập restore một lần, checklist release, kế hoạch rollback. Sau go-live: bảo trì định kỳ theo `references/maintenance.md`.
