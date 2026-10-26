---
id: P0-T02
title: Tenants, users, memberships schema + RLS
phase: P0
lane: DB
status: done
deps: [P0-T01]
touches: [db/migrations/**, db/schema/core.ts]
size: M
---

## Goal
Multi-tenant foundation: tables `tenants`, `users` (global), `memberships(tenant_id, user_id, role)`, an `app_user` role that does not bypass RLS, helper `app_current_tenant()`.

## Acceptance criteria
- [x] Migration runs on an empty DB and rolls back
- [x] App role is not superuser and has no BYPASSRLS
- [x] Without tenant context, queries on tenant tables return 0 rows (SQL test)
