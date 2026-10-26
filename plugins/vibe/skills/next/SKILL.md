---
name: next
description: "Làm việc tiếp theo của dự án: chọn task sẵn sàng (hoặc task bạn chỉ định), code kèm test theo quy ước của codebase, chạy kiểm tra, cập nhật task card."
argument-hint: "[mã task, vd P1-T03; để trống là task nên làm tiếp]"
disable-model-invocation: true
---

Task được chỉ định (có thể trống): $ARGUMENTS

1. Không có `docs/tasks/`: nói dự án chưa có task card, gợi ý `/vibe:start`, rồi dừng.
2. Chọn task:
   - Có mã task: dùng đúng task đó. Task phụ thuộc vào task chưa xong thì báo user và hỏi có làm task phụ thuộc trước không.
   - Không có mã: theo `python3 "${CLAUDE_SKILL_DIR}/../tasks/scripts/tasks.py" next --dir docs/tasks` (task đang dở được ưu tiên trước task mới).
3. Làm task theo skill `build`: đọc task card, `CLAUDE.md` và chỗ tương tự trong codebase; code kèm test; chạy test, typecheck, lint; chỉ sửa trong phạm vi `touches` của task.
4. Xong: cập nhật task card (trạng thái, ghi chú cho người sau), rồi báo user bằng tiếng Việt: đã làm gì, test nào đã chạy và kết quả, việc còn lại. Gợi ý `/vibe:check` trước khi merge.

Một lần gọi làm một task. Muốn làm tiếp thì gọi lại `/vibe:next`.
