---
name: check
description: "Kiểm thay đổi trước khi merge: chạy lint, typecheck, test, review độc lập theo checklist, báo PASS hoặc BLOCK kèm bằng chứng."
argument-hint: "[branch, số PR hoặc mã task; để trống là thay đổi hiện tại]"
disable-model-invocation: true
---

Phạm vi cần kiểm (có thể trống): $ARGUMENTS

Dùng skill `review` cho phạm vi trên; để trống thì là thay đổi của branch hiện tại so với branch gốc (`git diff` với branch phase hoặc `main`). Báo kết quả bằng tiếng Việt:

- **PASS** hoặc **BLOCK** ở dòng đầu.
- Bằng chứng: lệnh đã chạy và kết quả (test, typecheck, lint), các mục checklist đã soát.
- BLOCK thì liệt kê từng vấn đề kèm file, dòng và cách sửa; gợi ý `/vibe:next <mã task>` để sửa.

Lệnh này không sửa code.
