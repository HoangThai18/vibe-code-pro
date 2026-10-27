---
tags: [backend, laravel, concurrency]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Edit, Write, Skill]
---

Lễ tân bên mình vẫn đặt trùng giờ cho cùng một kỹ thuật viên khi 2 người bấm gần như cùng lúc, dù code đã kiểm tra trùng trong transaction và test `BookingTest` vẫn pass. Laravel 13 + MySQL 8.4. Sửa giúp mình cho chắc, và test thế nào để chứng minh là hết trùng?
