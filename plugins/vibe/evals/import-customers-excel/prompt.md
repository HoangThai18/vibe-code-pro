---
tags: [backend, import]
max_turns: 10
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

Spa dùng app của mình (Node + PostgreSQL có RLS, nhiều spa dùng chung) vừa chuyển từ phần mềm cũ: có file Excel khoảng 20.000 khách (Họ tên, SĐT, Ngày sinh) và file CSV xuất từ phần mềm cũ. Thiết kế giúp mình chức năng nhập khách từ file, kèm đoạn code chính: cho xem trước dòng nào lỗi rồi mới nhập, nhập lại file cũng không bị trùng khách.
