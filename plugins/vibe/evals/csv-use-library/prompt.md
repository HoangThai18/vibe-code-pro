---
tags: [hygiene, backend]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Bash, Edit, Write, Skill]
---

spa gửi danh sách khách xuất từ Excel ra CSV (mẫu ở `test/fixtures/customers.csv`, cột Họ tên, Số điện thoại, Ghi chú). Viết giúp mình hàm `parseCustomersCsv(text)` ở `src/customers/import-csv.js`, trả về danh sách khách hợp lệ và lỗi theo từng dòng, kèm test.
