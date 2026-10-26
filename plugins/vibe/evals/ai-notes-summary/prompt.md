---
tags: [ai, security]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Edit, Write, Skill]
---

Thêm tính năng "tóm tắt ghi chú khách bằng AI" cho nhân viên spa: viết hàm `summarizeCustomerNotes(ctx, customerId)` trong `src/ai/summarize-notes.ts`, dùng Claude qua `@anthropic-ai/sdk`, trả về bản tóm tắt ngắn và các việc cần làm tiếp. Chưa cần route.
