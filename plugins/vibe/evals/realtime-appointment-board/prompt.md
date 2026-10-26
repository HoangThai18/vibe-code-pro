---
tags: [backend, realtime]
max_turns: 10
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

App đặt lịch spa của mình (Next.js + Node + Postgres có RLS, nhiều spa dùng chung, API chạy 3 instance) cần màn hình lịch hẹn tự cập nhật khi lễ tân khác hoặc trang đặt lịch online tạo/huỷ lịch, và nhân viên được gán lịch thì nhận thông báo trong app. Thiết kế giúp mình phần realtime, kèm đoạn code chính.
