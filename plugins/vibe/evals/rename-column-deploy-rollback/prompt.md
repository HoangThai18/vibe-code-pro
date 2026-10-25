---
tags: [ship, migration]
max_turns: 15
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

Tuần sau team mình deploy bản đổi tên cột customer_name thành full_name trong bảng customers (Postgres, app chạy 3 instance sau load balancer, không được downtime). Lên kế hoạch deploy và rollback giúp mình.
