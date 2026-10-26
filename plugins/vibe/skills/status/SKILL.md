---
name: status
description: "Xem dự án tới đâu: tiến độ theo phase, task đang làm, task sẵn sàng, task bị chặn, rủi ro và quyết định đang chờ. Chỉ đọc, không sửa gì."
disable-model-invocation: true
---

1. Có `docs/tasks/`: chạy `python3 "${CLAUDE_SKILL_DIR}/../tasks/scripts/tasks.py" status --dir docs/tasks` và `python3 "${CLAUDE_SKILL_DIR}/../tasks/scripts/tasks.py" next --dir docs/tasks`. Đọc thêm `docs/STATUS.md` và `docs/HANDOFF.md` nếu có.
2. Tóm tắt bằng tiếng Việt, tối đa 10 dòng: phần trăm xong theo phase; task đang dở; **một** việc nên làm tiếp kèm lý do; task bị chặn và chặn bởi gì; rủi ro hoặc quyết định đang chờ user. Kết bằng lệnh gợi ý, vd `/vibe:next P1-T03`.
3. Không có `docs/tasks/`: nói dự án chưa theo quy trình vibe và gợi ý `/vibe:start`.

Không sửa file, không chạy lệnh nào khác ngoài đọc.
