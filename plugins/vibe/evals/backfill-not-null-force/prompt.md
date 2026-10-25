---
tags: [backend, migration]
max_turns: 15
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

Bảng customers trên Postgres có 5 triệu dòng, đã bật RLS kèm FORCE ROW LEVEL SECURITY (multi-tenant). Mình cần thêm cột phone_normalized NOT NULL, giá trị chuẩn hoá từ cột phone. Hệ thống đang chạy production, không được downtime. Lên kế hoạch migration giúp mình.
