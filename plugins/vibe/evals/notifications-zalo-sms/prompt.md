---
tags: [backend, notifications]
max_turns: 10
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

App spa của mình (Node + PostgreSQL, nhiều spa dùng chung) đang gửi SMS nhắc lịch, tốn tiền quá. Mình muốn chuyển sang nhắc qua Zalo (ZNS), khách nào không có Zalo thì mới gửi SMS. Thỉnh thoảng spa cũng muốn gửi tin khuyến mãi qua SMS. Thiết kế giúp mình phần gửi tin này (chưa cần code): cần chuẩn bị gì, lưu ý gì để tin tới nơi và không phạm luật?
