---
tags: [backend, permissions, dotnet]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Edit, Write, Skill]
---

API ASP.NET Core multi-tenant của mình (minimal API + EF Core + Postgres RLS) cần phân quyền theo vai trò owner / manager / staff, quyền kiểu customer.read, customer.write, appointment.write, staff chỉ được đặt lịch cho chính mình. Mình định thêm claim role vào JWT lúc login rồi dùng RequireRole cho từng endpoint. Làm giúp mình nhé
