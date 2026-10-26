---
name: vibe-backend
description: "Backend data and API layer: schema, indexes, transactions, safe migrations, ORMs (Prisma, Drizzle, TypeORM, Sequelize, SQLAlchemy, Django, GORM, ActiveRecord), file storage, multi-tenancy (tenant_id, Postgres RLS, isolation tests), BE-FE API contracts, auth, background jobs, app security, personal data under Vietnamese law. Use for tables, models, queries, endpoints, RLS/Supabase policies, slow or N+1 queries, SaaS tenancy, background email/SMS, data deletion requests. Also use for Vietnamese requests like 'tạo bảng', 'query chậm', 'nhiều khách hàng dùng chung', 'xoá dữ liệu cá nhân', 'Nghị định 13', 'luật bảo vệ dữ liệu'."
---

# Backend: data, ORM, multi-tenancy, API

Paths are relative to this skill folder. Read only the file for the task at hand:

| Task | Read |
|---|---|
| Table design, data types, constraints, indexes, transactions, pagination, migrations, file storage | `references/data-layer.md` |
| ORM code: N+1, transactions, raw SQL, migration tools, connection pools | `references/orm.md` |
| Many customers sharing one system (SaaS, customer workspaces) | `references/multi-tenant.md`, then `references/postgres-rls.md` and `references/isolation-tests.md` when you get there |
| BE-FE API, or changing a live API | `references/api-contract.md` and `references/api-conventions.md` (mobile/desktop apps: section 8, long-lived clients) |
| Login, sessions, role-based permissions, API keys, webhooks | `references/auth.md` |
| Background jobs: email/SMS, scheduled work, retries, dead letter queue | `references/jobs.md` |
| File uploads, server fetching user-supplied URLs (SSRF), rate limits, security headers, secret and dependency scanning | `references/app-security.md` |
| Personal and sensitive data: consent, export/deletion requests, data leaks, cross-border transfer, Vietnamese law | `references/privacy.md` |
| Slow queries, load testing, performance targets | the `vibe-ship` skill (`references/performance.md`) |

Before using an ORM or library API you are unsure of for the installed version, check the version and docs (the `vibe-plan` skill, `references/tech-research.md`). ORMs change APIs between major versions often.

**Right-size it.** Read only the matching file: fixing one query needs no multi-tenant reading; single-customer systems skip the tenant parts. SQL examples are PostgreSQL. On MySQL, SQLite or MongoDB keep the principles and find the equivalent in that DB's docs (e.g. MySQL has no RLS: filter by tenant in the repository and test isolation harder); don't copy Postgres syntax.

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
9. **External calls and slow work go through background jobs**, enqueued in the same transaction as the data; jobs are idempotent and carry `tenant_id` (`references/jobs.md`).
10. **Personal data**: collect only needed fields, consent per purpose; health, location and financial data are sensitive (`references/privacy.md`).

## Before calling it done

- Tests run against a **real DB** (container or test DB); don't mock the DB layer for queries, migrations, RLS.
- New query on a table that can grow large: check `EXPLAIN (ANALYZE, BUFFERS)` with enough data.
- Endpoint touching tenant data: has an isolation test (tenant A touching B's resource → 404).
- Migration: runs on an empty DB **and** on a DB with sample data.
