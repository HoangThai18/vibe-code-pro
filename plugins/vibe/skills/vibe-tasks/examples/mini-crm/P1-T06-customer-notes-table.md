---
id: P1-T06
title: Customer notes table + RLS
phase: P1
lane: DB
status: todo
deps: [P1-T02]
touches: [db/migrations/**, db/schema/notes.ts]
size: S
---

## Goal
Tenant-owned `customer_notes` table with composite FK `(tenant_id, customer_id) → customers(tenant_id, id)` so a note can't be attached to another tenant's customer.

## Acceptance criteria
- [ ] Inserting a note with another tenant's customer_id is rejected by the DB (test)
- [ ] RLS + FORCE enabled, index `(tenant_id, customer_id, created_at DESC)`
