# vibe (Vibe Code Pro)

Bộ 9 skill và 2 agent cho Claude Code để vibe code ra phần mềm thật: phân tích nghiệp vụ và lên kế hoạch (`plan`), chia task và theo dõi tiến độ (`tasks`), code theo đúng kiến trúc của codebase (`architecture`), backend với DB, ORM, multi-tenant, Postgres RLS, xác thực và phân quyền (`backend`), frontend theo design và quản lý state (`frontend`), làm code cùng test kể cả test giao diện bằng Playwright (`build`), nghiệm thu có bằng chứng với verifier độc lập (`review`), CI/CD, rollback, giám sát, backup và restore (`ship`), sửa bug và xử lý sự cố (`fix`).

Skill tự kích hoạt theo câu nói tự nhiên, ví dụ "phân tích nghiệp vụ app đặt lịch spa", "tới đâu rồi, làm gì tiếp?", "làm task P1-T03", "deploy lên production", "lỗi 500 khi tạo khách". Không cần thiết lập gì thêm; chỉ khi muốn chạy song song nhiều agent mới cần thêm `worktree.baseRef: "head"` vào `.claude/settings.json`.

Cài đặt (Claude Code 2.1.275 trở lên):

```bash
/plugin install vibe --marketplace OWNER/vibe-code-pro
```

Hướng dẫn đầy đủ, quy trình, và danh sách những gì đã được chạy kiểm chứng: xem README ở thư mục gốc của repo.
