---
tags: [backend, search, mysql]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Edit, Write, Skill]
---

Ô tìm khách của app spa (Node + MySQL 8.4, không có RLS, query nào cũng lọc `tenant_id`) đang lỗi: gõ "dang anh" không ra "Đặng Thị Ánh", gõ "thao nguyen" không ra "Nguyễn Thị Thảo", gõ "0912 345 678" cũng không ra. Kết quả phải xếp đúng thứ tự chữ cái tiếng Việt (Đ sau D, Ă Â sau A). Có spa gần 200 nghìn khách nên phải nhanh. Sửa `src/customers/search.ts` và thêm migration vào `db/migrations/`.
