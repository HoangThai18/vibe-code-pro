---
id: P1-T05
title: Create/edit customer form
phase: P1
lane: FE
status: todo
deps: [P1-T01]
touches: [apps/web/src/features/customers/form/**, apps/web/src/routes.tsx]
size: M
---

## Goal
Create/edit form per the "Customers / Form" mockup, validated with the shared schema, showing `customer_email_taken` right under the email field.

## Acceptance criteria
- [ ] Client-side validation uses `CreateCustomerInput` from packages/contracts
- [ ] Server errors show on the right field
- [ ] Drawer open animation per motion spec (200ms, ease-out), off under prefers-reduced-motion
