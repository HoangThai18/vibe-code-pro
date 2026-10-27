---
tags: [backend, migrations, mysql]
max_turns: 20
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Edit, Write, Skill]
---

Bảng `appointments` trên production khoảng 20 triệu dòng (MySQL 8.4, app chạy 24/7, lúc nào cũng có lễ tân đặt lịch). Mình cần thêm cột `reminder_sent_at DATETIME(3) NULL` và index `(tenant_id, staff_user_id, starts_at)` cho màn hình lịch kỹ thuật viên. Viết migration vào `db/migrations/` và chỉ mình cách chạy cho an toàn, không làm treo app.
