# Architecture

## Quyết định (ADR)

| # | Quyết định | Lý do |
|---|---|---|
| 1 | Shared schema + `tenant_id` + RLS (FORCE) | Nhiều spa nhỏ, một DB |
| 2 | Session cookie cho web, bearer token cho app | Web và app mobile |
