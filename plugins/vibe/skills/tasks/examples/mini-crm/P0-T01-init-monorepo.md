---
id: P0-T01
title: Khởi tạo monorepo, lint, test, CI
phase: P0
lane: INFRA
status: done
deps: []
touches: [package.json, pnpm-workspace.yaml, .github/workflows/**, apps/api/package.json, apps/web/package.json]
size: M
---

## Mục tiêu
Có khung monorepo (apps/api, apps/web, packages/contracts) chạy được lint, typecheck, test trên CI cho mỗi PR.

## Acceptance criteria
- [x] `pnpm lint && pnpm typecheck && pnpm test` pass ở root
- [x] Workflow CI chạy trên PR và báo đỏ khi test fail

## Cách verify
```bash
pnpm install && pnpm lint && pnpm typecheck && pnpm test
```
