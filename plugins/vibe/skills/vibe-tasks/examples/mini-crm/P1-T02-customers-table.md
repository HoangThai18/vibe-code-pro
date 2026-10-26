---
id: P1-T02
title: Customers table + RLS
phase: P1
lane: DB
status: doing
deps: [P0-T02]
touches: [db/migrations/**, db/schema/customers.ts]
size: S
---

## Goal
Tenant-owned `customers` table: `tenant_id NOT NULL`, `UNIQUE (tenant_id, id)`, `UNIQUE (tenant_id, email)`, index `(tenant_id, created_at DESC)`, RLS + FORCE.

## Acceptance criteria
- [ ] Migration runs without errors on a DB with sample data
- [ ] The RLS check query in the `vibe-backend` skill (`references/postgres-rls.md` section 8) returns no rows
- [ ] Duplicate email in the same tenant is rejected; in another tenant it is allowed
