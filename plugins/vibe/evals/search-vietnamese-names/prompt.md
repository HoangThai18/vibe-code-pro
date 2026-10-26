---
tags: [backend, search]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Edit, Write, Skill]
---

Ô tìm khách của app spa (Postgres 16, có RLS theo tenant, app chạy bằng role `app_user`) đang dùng ILIKE: gõ "nguyen thao" hay "thao" không ra "Nguyễn Thị Thảo", gõ "0912 345 678" cũng không ra. Có spa gần 200 nghìn khách nên phải nhanh. Sửa `src/customers/search.ts` và thêm migration vào `db/migrations/`.
