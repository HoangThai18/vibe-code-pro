---
tags: [hygiene]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Bash, Edit, Write, Skill]
---

viết giúp mình hàm `invoiceTotal(lines, discountCode)` ở `src/billing/total.js`: cộng các dòng (đơn giá × số lượng), áp mã giảm giá (phần trăm hoặc số tiền, tổng không được âm), rồi cộng VAT 8%, làm tròn đến đồng. Kèm test, chạy bằng `node --test`.
