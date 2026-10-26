---
name: start
description: "Bắt đầu với vibe: dự án mới thì làm rõ yêu cầu, phân tích nghiệp vụ, lên plan và chia task; dự án đã có code thì khảo sát codebase, tạo CLAUDE.md rồi chia task cho phần sắp làm."
argument-hint: "[ý tưởng sản phẩm hoặc tính năng; để trống nếu dự án đã có code]"
disable-model-invocation: true
---

Yêu cầu của user (có thể trống): $ARGUMENTS

1. Xem thư mục hiện tại: đã có code chưa (`package.json`, `pyproject.toml`, `src/`...), đã có `CLAUDE.md`, `docs/plan/`, `docs/tasks/` chưa.
2. Chọn một đường:
   - **Đã có `docs/tasks/`**: dự án đang theo quy trình. Không làm lại plan. Báo tiến độ ngắn (`python3 "${CLAUDE_SKILL_DIR}/../tasks/scripts/tasks.py" status --dir docs/tasks`) và gợi ý `/vibe:next`. Nếu yêu cầu ở trên là tính năng mới, dùng skill `plan` ở mức vừa đủ cho tính năng đó rồi skill `tasks` thêm task card.
   - **Chưa có code**: dùng skill `plan` cho yêu cầu trên (hỏi 1–2 lượt, rồi DOMAIN, PRD, ARCHITECTURE, PHASES, CLAUDE.md), sau đó skill `tasks` tạo task card cho phase đầu tiên. Yêu cầu còn trống thì hỏi user muốn làm sản phẩm gì trước.
   - **Đã có code, chưa có quy trình**: dùng skill `architecture` để khảo sát quy ước của codebase và viết `CLAUDE.md` (lệnh chạy, lệnh test, cấu trúc, quy ước). Có yêu cầu mới thì tiếp skill `plan` ở mức vừa đủ cho phần đó, rồi skill `tasks`.
3. Kết thúc bằng: đã tạo hoặc sửa file nào, quyết định nào đang chờ user, việc tiếp theo (thường là `/vibe:next`).

Không viết code tính năng trong lệnh này.
