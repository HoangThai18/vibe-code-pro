---
tags: [ship, performance]
max_turns: 10
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

Màn danh sách khách của app (Node + PostgreSQL, khoảng 200 spa dùng chung DB, bảng customers 2 triệu dòng) giờ cao điểm load 3–4 giây. Team định thêm Redis để cache danh sách. Nên làm gì?
