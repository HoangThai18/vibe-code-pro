---
id: P0-T01
title: Set up monorepo, lint, test, CI
phase: P0
lane: INFRA
status: done
deps: []
touches: [package.json, pnpm-workspace.yaml, .github/workflows/**, apps/api/package.json, apps/web/package.json]
size: M
---

## Goal
A monorepo skeleton (apps/api, apps/web, packages/contracts) that runs lint, typecheck and tests in CI on every PR.

## Acceptance criteria
- [x] `pnpm lint && pnpm typecheck && pnpm test` pass at the root
- [x] CI workflow runs on PRs and fails when a test fails

## How to verify
```bash
pnpm install && pnpm lint && pnpm typecheck && pnpm test
```
