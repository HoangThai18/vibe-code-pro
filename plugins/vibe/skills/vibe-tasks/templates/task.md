---
id: P1-T01
title: Short title starting with a verb
phase: P1
lane: BE
status: todo
deps: []
touches: []
size: M
---

## Goal
1–3 sentences: what to do, which PRD user flow it serves.

## Context to read
- AGENTS.md
- docs/plan/ARCHITECTURE.md (relevant section)
- docs/contracts/... (if the task uses an API)
- docs/design/... (if the task has UI)
- Code to imitate: path to a similar module done well

## Sub-tasks
- [ ] Step 1
- [ ] Step 2

## Acceptance criteria
- [ ] Verifiable condition, with how to check it (test name, command, screenshot)
- [ ] Tenant data: read/update/delete another tenant's resource → 404 (if the task touches tenant data)

## Security
"None" unless the task touches auth, tenant or personal data, uploads or outbound calls. Then briefly: what data and whose; who may do it (permission, e.g. `customer.write`) and where it's checked; untrusted input; outbound calls; abuse and what stops it.

## How to verify
```bash
# test / typecheck / lint commands specific to this task
```

## Out of scope
- What this task does NOT do, so the agent doesn't spread into other work

## Notes / decisions
Updated by the coordinator: small decisions, blockers, branch/commit/PR, review link.
