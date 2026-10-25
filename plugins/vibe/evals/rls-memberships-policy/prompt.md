---
tags: [backend, security]
max_turns: 15
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

App SaaS multi-tenant trên Postgres, bảng memberships(tenant_id, user_id, role). Lúc đăng nhập, user cần liệt kê các workspace mình thuộc về khi chưa chọn tenant nào. Viết giúp mình RLS policy cho bảng memberships, các request bình thường thì vẫn phải cô lập theo tenant hiện tại.
