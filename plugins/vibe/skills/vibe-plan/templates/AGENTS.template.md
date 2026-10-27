# Project name

1–2 sentences: what the product is, for whom.

## Commands
- Install: `pnpm install`
- Dev: `pnpm dev`
- Test: `pnpm test` · one file: `pnpm test -- path/to/file`
- Lint / typecheck: `pnpm lint` / `pnpm typecheck`
- Build: `pnpm build`
- Migrations: `pnpm db:migrate` · new: `pnpm db:new <name>`

## Structure
- `apps/web`: frontend
- `apps/api`: backend
- `packages/contracts`: shared API schemas (source of truth for BE and FE)
- `docs/plan/`: PRD, architecture, phases · `docs/tasks/`: task cards · `docs/STATUS.md`: progress

## Mandatory rules
- Every query on a tenant table runs in a transaction with tenant context; never accept tenant_id from the client.
- APIs follow the contract in `packages/contracts`; to change an API, change the contract first.
- No new dependency unless the task requires it.
- Migrations: only one task creates a migration at a time; safe on tables that already hold data.
- Git: commit a checkpoint before each task. Undo with `git restore <file>` (uncommitted) or `git revert <sha>` (committed). `git reset --hard`, `git clean`, force-push only with the user's explicit consent.
- Secrets: never print `.env` files or secret values. Production keys, service-role keys and the production `DATABASE_URL` never go into chat or a local `.env`.
- Tests: never make a check pass by deleting, skipping or loosening tests or by updating expected values or snapshots to match new output.

## Conventions
- Reference module to imitate: `src/modules/<name>/` (routes, service, repository, schema)
- Naming: ...
- Errors: shared error class with `code` (`src/shared/errors.ts`), mapped to HTTP in middleware
- Validation: schemas at the boundary (route/DTO), shared with FE via the contract
- Tests: file location, test data setup, how much to mock
- API error format: `{ "error": { "code", "message", "details", "requestId" } }`
- Commits: `<TASK-ID>: <description>`

## Stack notes
- (Libraries whose API changes often: version + research note link, e.g. "Prisma 6: see docs/research/prisma.md")

## Agent tools
- (Only tools installed for this project, with usage limits. E.g. "Context7: ask with library name and version", "Supabase MCP: dev project only, read_only", "Chrome DevTools MCP: only local/staging app with test accounts". Nothing installed: delete this section.)

## Workflow
This project uses the `vibe` skills: plan → tasks → build (one agent writes code and tests) → review → ship. A task goes `todo → doing → review` (code done, branch `task/<ID>` kept) `→ done` (merged into `phase/Pn` after review PASS). Only the main session updates task cards and `docs/STATUS.md`; sub-agents (if any) report results instead of editing them.
