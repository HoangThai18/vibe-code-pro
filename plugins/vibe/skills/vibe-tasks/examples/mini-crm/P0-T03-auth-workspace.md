---
id: P0-T03
title: Login + workspace selection
phase: P0
lane: BE
status: done
deps: [P0-T02]
touches: [apps/api/src/modules/auth/**, apps/api/src/routes.ts]
size: M
---

## Goal
A user logs in, then picks a workspace they belong to (redirect to `/t/{tenantId}/...`). Every business API has the tenant in the path (`/v1/t/{tenantId}/...`); the server checks membership on each request, then sets `app.tenant_id` per transaction.

## Acceptance criteria
- [x] Calling the API of a workspace you are not a member of → 404
- [x] Every request runs in a transaction with `set_config('app.tenant_id', ..., true)`
