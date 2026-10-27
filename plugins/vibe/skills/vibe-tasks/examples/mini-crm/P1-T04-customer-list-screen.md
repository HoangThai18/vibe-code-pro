---
id: P1-T04
title: Customer list screen
phase: P1
lane: FE
status: todo
deps: [P1-T01]
touches: [apps/web/src/features/customers/list/**, apps/web/src/routes.tsx]
size: M
---

## Goal
List screen per the "Customers / List" mockup (linked in docs/design/; made in Claude Design, Figma or as a screenshot): search, status filter, pagination, all loading / empty / error states. Use MSW mocks until the API is done.

## Acceptance criteria
- [ ] Matches the mockup at 375 / 768 / 1280 (screenshots attached to the report)
- [ ] All states: loading skeleton, empty, error with a retry button
- [ ] Keyboard navigable, visible focus
