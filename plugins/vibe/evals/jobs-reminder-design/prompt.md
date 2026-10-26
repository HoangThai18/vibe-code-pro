---
tags: [backend, jobs]
max_turns: 10
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

App quản lý spa của mình (Node + PostgreSQL có RLS, khoảng 200 spa, API chạy 3 instance) cần gửi SMS nhắc khách trước lịch hẹn 24 giờ. Mình định thêm `setInterval` trong server API, mỗi phút quét lịch hẹn rồi gọi API SMS. Có ổn không? Thiết kế giúp mình cách làm đúng.
