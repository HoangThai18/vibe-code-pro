---
name: vibe-backend
description: "Backend data and API layer: schema, indexes, transactions, safe migrations, ORMs (Prisma, Drizzle, TypeORM, SQLAlchemy, Django, ActiveRecord...), file storage, multi-tenancy (tenant_id, Postgres RLS, Supabase policies, isolation tests), BE-FE API contracts, auth and permission models, background jobs, app security (uploads, SSRF when the server fetches user URLs such as link previews or webhooks, rate limits), personal data under Vietnamese law. Use for tables, queries, endpoints, RLS policies, slow or N+1 queries, payments (VNPay, MoMo, VietQR, refunds, e-invoices), accent-insensitive search, Zalo/SMS/email delivery, realtime updates (SSE), Excel/CSV import and export, data deletion requests. Also use for Vietnamese requests like 'tạo bảng', 'query chậm', 'nhiều khách hàng dùng chung', 'phân quyền', 'tích hợp VNPay', 'tìm không dấu', 'gửi Zalo ZNS', 'nhập khách từ Excel', 'cập nhật realtime', 'xoá dữ liệu cá nhân'."
---

# Backend: data, ORM, multi-tenancy, API

Paths are relative to this skill folder. Read only the file for the task at hand:

| Task | Read |
|---|---|
| Table design, data types, constraints, indexes, transactions, pagination, migrations, file storage | `references/data-layer.md` |
| ORM code: N+1, transactions, raw SQL, migration tools, connection pools | `references/orm.md` |
| Many customers sharing one system (SaaS, customer workspaces) | `references/multi-tenant.md` (the example schema every reference uses), then `references/postgres-rls.md` and `references/isolation-tests.md` when you get there |
| Supabase, or any client holding the anon key (single-tenant too) | `references/postgres-rls.md` section 6 |
| BE-FE API, or changing a live API, Idempotency-Key | `references/api-contract.md` and `references/api-conventions.md` (mobile/desktop apps: section 8, long-lived clients) |
| Login, sessions, password reset, OTP, MFA, role-based permissions, API keys, webhooks, admin impersonation, audit log | `references/auth.md` |
| Native app login: mobile/desktop bearer tokens, refresh rotation, Apple/Google sign-in | `references/native-auth.md` |
| Choosing a permission model: per-tenant custom roles, per-module permission matrix (bitmask), branch or own-record scope, policy engines | `references/permissions.md` |
| Background jobs: email/SMS, scheduled work, retries, dead letter queue | `references/jobs.md` |
| File uploads, server fetching user-supplied URLs (SSRF), rate limits, security headers, tenant secrets (provider keys), secret and dependency scanning | `references/app-security.md` |
| Personal and sensitive data: consent, export/deletion requests, data leaks, cross-border transfer, Vietnamese law | `references/privacy.md` |
| Payments: VNPay, MoMo, bank transfer with VietQR and SePay/Casso webhooks, refunds, reconciliation, e-invoices, subscriptions | `references/payments.md` |
| Search: customers by name or phone without accents, notes full-text, search under RLS | `references/search.md` |
| Email, Zalo (ZNS/ZBS) and SMS delivery: DNS, unsubscribe, templates and tokens, brandname, advertising rules, OTP abuse | `references/notifications.md` |
| Live updates and in-app notifications: SSE/WebSocket, LISTEN/NOTIFY fan-out, refetch on reconnect | `references/realtime.md` |
| Importing or exporting Excel/CSV (CSV injection on export): column mapping, row-error preview, re-runnable imports, error report | `references/data-import.md` |
| MySQL or MariaDB instead of PostgreSQL: tenant isolation without RLS, utf8mb4 and collations for Vietnamese search, DATETIME and time zones, online DDL and metadata locks, double booking without exclusion constraints, SKIP LOCKED jobs | `references/mysql.md` |
| Spring Boot (Java): tenant per transaction with JPA, Flyway roles, method security, N+1, double booking, scheduled jobs under RLS | `references/spring.md` |
| ASP.NET Core / .NET: EF Core + Npgsql, minimal APIs, tenant endpoint filter, query filters and DbContext pooling, BackgroundService jobs, EF migrations in CI | `references/dotnet.md` |
| Laravel (PHP): tenant scope without RLS, route model binding, FormRequests, Gates/Policies, queues, no double booking on MySQL, Laravel on PostgreSQL RLS | `references/laravel.md` (MySQL-wide facts: `references/mysql.md`) |
| Formatting money, dates and messages on the server (SMS, email, PDF), time zones, Vietnamese sorting | the `vibe-frontend` skill (`references/i18n.md`) |
| Slow queries, load testing, performance targets | the `vibe-ship` skill (`references/performance.md`) |

Before using an ORM or library API you are unsure of for the installed version, check the version and docs (the `vibe-plan` skill, `references/tech-research.md`). ORMs change APIs between major versions often.

**Right-size it.** Read only the matching file: fixing one query needs no multi-tenant reading; single-customer systems skip the tenant parts (on Supabase they still need RLS). SQL examples are PostgreSQL. On MySQL, SQLite or MongoDB keep the principles and find the equivalent in that DB's docs (on MySQL read `references/mysql.md`); don't copy Postgres syntax.

## Always-on rules

The costliest and most common mistakes; apply them even before reading any detail file:

1. **Invariants live in the DB**, not only in code: NOT NULL, FK, UNIQUE, CHECK. Code can have bugs; constraints don't.
2. **Money** is an integer in the smallest unit (VND has no minor unit) or `numeric`, never float. **Time** is `timestamptz`, stored in UTC.
3. **Index FK columns** (Postgres doesn't do it for you). Index the way you query: equality columns first, sort/range columns after.
4. **Never call an external API inside a DB transaction**: the transaction holds a connection and locks while waiting on the network.
5. **Lists are always paginated** and capped; large tables use cursor (keyset) pagination, not offset.
6. **Read the SQL the ORM generates** for every migration before running it; never edit a migration that already ran in another environment; migrations on large tables must be safe while the table holds data and is in use.
7. **Multi-tenant systems**: the tenant is in the API path (`/v1/t/{tenantId}/...`) and the server checks membership on every request; never take the tenant from body/query or rely on an implicit "current tenant" in the session. Every tenant-owned table has `tenant_id`. Follow `references/multi-tenant.md`; don't improvise.
8. **API**: lock the contract before BE and FE work in parallel; another tenant's resource returns 404.
9. **External calls and slow work go through background jobs**, enqueued in the same transaction as the data; jobs are idempotent and carry `tenant_id`; scheduled jobs list tenants with `app_tenant_ids()`, since RLS shows a worker 0 tenants (`references/jobs.md`).
10. **Personal data**: collect only needed fields, consent per purpose; health, location and financial data are sensitive (`references/privacy.md`).
11. **Payments**: only a verified provider callback (or a status query) marks a payment paid, once, from `pending`, after checking the amount against the database (`references/payments.md`).
12. **The user's decisions** (permission model, tenancy model, auth method, payment provider) not yet settled in the project docs (PRD, `ARCHITECTURE.md`, ADRs): offer 2–3 options with trade-offs and a recommendation, ask before building, and record the answer as an ADR.

## Before calling it done

- Tests run against a **real DB** (container or test DB); don't mock the DB layer for queries, migrations, RLS.
- New query on a table that can grow large: check `EXPLAIN (ANALYZE, BUFFERS)` with enough data.
- Endpoint touching tenant data: has an isolation test (tenant A touching B's resource → 404).
- Migration: runs on an empty DB **and** on a DB with sample data.
