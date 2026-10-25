---
tags: [build, e2e, frontend]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Edit, Write, Skill]
---

Viết giúp mình test Playwright ở tests/e2e/workspace-switch.spec.ts cho luồng: user thuộc 2 workspace, đang xem danh sách khách của Spa Hoa Mai thì đổi sang Spa Bạch Dương, phải không bao giờ thấy khách của Spa Hoa Mai ở workspace mới. Thông tin app và tài khoản test trong README.md. Máy này chưa cài Playwright nên chưa cần chạy, chỉ cần viết test và config.
