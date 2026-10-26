---
name: help
description: "Bảng lệnh của vibe kèm câu nói mẫu; nếu dự án đang theo quy trình thì gợi ý lệnh nên dùng tiếp."
disable-model-invocation: true
---

Trả lời bằng tiếng Việt, ngắn gọn:

1. In nguyên văn bảng này:

| Gõ | Để làm gì |
|---|---|
| `/vibe:start <ý tưởng>` | Bắt đầu: dự án mới thì phân tích nghiệp vụ và lên plan; dự án có sẵn thì khảo sát code, tạo CLAUDE.md, chia task |
| `/vibe:status` | Xem tới đâu rồi: tiến độ, task đang làm, task bị chặn |
| `/vibe:next [P1-T03]` | Làm việc tiếp theo, hoặc đúng task bạn chỉ định: code kèm test |
| `/vibe:check` | Kiểm thay đổi trước khi merge: chạy test, review độc lập, PASS hoặc BLOCK |
| `/vibe:fix <mô tả lỗi>` | Sửa bug, xử lý sự cố production |
| `/vibe:ship <việc>` | Deploy, rollback, backup, giám sát |
| `/vibe:help` | Bảng này |

Lệnh chuyên môn (Claude tự gọi khi cần, gõ tay cũng được): `/vibe:plan`, `/vibe:tasks`, `/vibe:architecture`, `/vibe:backend`, `/vibe:frontend`, `/vibe:mobile`, `/vibe:desktop`, `/vibe:ai`, `/vibe:build`, `/vibe:review`.

2. Thêm một dòng "Gợi ý:" theo trạng thái dự án:
   - Có `docs/tasks/`: chạy `python3 "${CLAUDE_SKILL_DIR}/../tasks/scripts/tasks.py" next --dir docs/tasks`. Còn task dở hoặc task sẵn sàng thì gợi ý `/vibe:next <mã task đó>`; không còn task nào thì gợi ý `/vibe:check` hoặc `/vibe:ship`.
   - Không có `docs/tasks/`: gợi ý `/vibe:start` kèm một câu mô tả sản phẩm.

3. Kết bằng một dòng: không cần nhớ lệnh, cứ nói bình thường, vd "làm tiếp đi", "lỗi 500 khi tạo khách", "deploy lên staging".

Không sửa file nào.
