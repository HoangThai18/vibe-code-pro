<p align="center">
  <img src="assets/hero.svg" width="100%" alt="vibe: Agent Skills for shipping real software. 12 skills: plan, tasks, architecture, backend, frontend, mobile, desktop, ai, build, review, ship, fix. Works with Claude Code, Codex, Cursor, Copilot, Gemini CLI and OpenCode.">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-7C3AED?style=flat-square"></a>
  <a href="https://agentskills.io"><img alt="Agent Skills standard" src="https://img.shields.io/badge/Agent%20Skills-standard-0891B2?style=flat-square"></a>
  <img alt="12 skills, 5 commands, 2 subagents" src="https://img.shields.io/badge/skills-12%20·%20commands%205%20·%20subagents%202-DB2777?style=flat-square">
  <img alt="Examples executed" src="https://img.shields.io/badge/examples-executed-059669?style=flat-square">
  <a href="#evals-with-and-without-the-skills"><img alt="Eval: 0.98 with the skills vs 0.75 without, 31 cases" src="https://img.shields.io/badge/eval-0.98%20with%20·%200.75%20without-F59E0B?style=flat-square"></a>
</p>

<p align="center"><b>English</b> · <a href="README.vi.md">Tiếng Việt</a></p>

Vibe coding is fast. Real software needs what prompts tend to forget: getting the domain right, tests that ship with the code, one customer's data never leaking to another, migrations that don't break the running version, a rollback path, backups that were actually restored. **vibe** packs that experience into 12 [Agent Skills](https://agentskills.io) for web, mobile (iOS, Android), desktop (Windows, macOS, Linux) and AI features, with backends on Node/TypeScript, Laravel, Spring Boot or ASP.NET Core over PostgreSQL or MySQL. Your agent picks the right skill from what you say and reads only the part it needs.

The skills are written in English so every agent reads them the same way, and they work with any agent that supports the open Agent Skills standard: Claude Code, OpenAI Codex, Cursor, GitHub Copilot, Gemini CLI, OpenCode, Cline, Goose, Roo Code, Amp, Windsurf and more. The agent answers in your language.

## Install

**Any agent** (the [`skills`](https://github.com/vercel-labs/skills) installer copies the skills into each agent's folder):

```bash
npx skills add HoangThai18/vibe-code-pro
```

**Claude Code plugin** (adds the two subagents; Claude Code 2.1.275+):

```bash
claude plugin install vibe --marketplace HoangThai18/vibe-code-pro
```

**Manual**: copy `plugins/vibe/skills/*` into the folder your agent reads.

| Agent | Project folder | User folder | Run a command |
|---|---|---|---|
| Claude Code | `.claude/skills/` | `~/.claude/skills/` | `/vibe-start` |
| OpenAI Codex | `.agents/skills/` | `~/.agents/skills/` | `$vibe-start` |
| Cursor | `.agents/skills/` or `.cursor/skills/` | `~/.cursor/skills/` | `/vibe-start` |
| GitHub Copilot (VS Code, CLI) | `.github/skills/` or `.agents/skills/` | `~/.copilot/skills/` | `/vibe-start` |
| Gemini CLI | `.agents/skills/` or `.gemini/skills/` | `~/.gemini/skills/` | ask: "use vibe-start" |
| OpenCode | `.agents/skills/` or `.opencode/skills/` | `~/.config/opencode/skills/` | ask: "use vibe-start" |
| Cline, Goose, Roo Code, Amp, Windsurf | `.agents/skills/` | `~/.agents/skills/` | `/vibe-start` (Windsurf: `@vibe-start`) |
| Kiro, Junie, Factory | `.kiro/skills/`, `.junie/skills/`, `.factory/skills/` | same under `~/` | `/vibe-start` |

```bash
git clone https://github.com/HoangThai18/vibe-code-pro
mkdir -p .agents/skills && cp -r vibe-code-pro/plugins/vibe/skills/* .agents/skills/
```

Keep all skills together: they refer to each other by name (`vibe-backend`, `vibe-tasks`...). Project instructions go in `AGENTS.md`; the plan skill also writes a one-line `CLAUDE.md` (`@AGENTS.md`) because Claude Code reads that file instead.

## Commands

| Command | What it does |
|---|---|
| `/vibe-start <idea>` | New project: clarify, analyze the domain, plan, create task cards. Existing code: survey it, write `AGENTS.md`, create task cards |
| `/vibe-status` | Where are we: progress, task in progress, blocked tasks, what to do next |
| `/vibe-next [P1-T03]` | Do the next task (or that one): code with tests, then stop at review (the branch is kept, nothing merged) |
| `/vibe-check [P1-T03 \| phase P1]` | Review with evidence: tests, acceptance criteria, independent verifier. PASS merges and marks the task done; BLOCK lists what to fix |
| `/vibe-fix <bug>` | Fix a bug or a production incident |
| `/vibe-ship <task>` | Deploy, rollback, backup, monitoring |
| `/vibe-help` | Command table and a suggestion based on the project's state |

A loop: `/vibe-start` → `/vibe-next` (stops at review) → `/vibe-check` (PASS merges) → `/vibe-next`. When a phase's tasks are done, `/vibe-check phase P1` closes it and the next `/vibe-next` splits the next phase. You can also just talk: *"plan a booking app for spas"*, *"where are we?"*, *"continue"*, *"500 error when creating a customer"*.

**Upgrading from 0.x**: every skill now has a `vibe-` prefix (`/vibe:start` → `/vibe-start`, `/vibe:check` → `/vibe-check`) and the skills are in English. New projects get `AGENTS.md`; an existing `CLAUDE.md` is kept and gains an `@AGENTS.md` line. Task cards and `docs/` need no change. Update with `claude plugin update vibe`, or run `npx skills add HoangThai18/vibe-code-pro` again.

## Workflow

<p align="center">
  <img src="assets/flow.svg" width="100%" alt="Idea → plan → tasks → build → review → ship → live. Build uses the architecture, backend, frontend, mobile, desktop and ai skills. Bugs go to fix, then back to tasks.">
</p>

Following Anthropic's guidance for agents: **one main agent + skills + tools**. Knowledge lives in skills and loads on demand; subagents only where they pay off (independent review, large independent tasks in parallel). Every session carries only the short skill descriptions: about **3.6k tokens** by Claude Code's `plugin details` estimate, which also counts about 340 tokens for the 5 commands. Agents that honor `disable-model-invocation` (Claude Code, VS Code Copilot, Cursor) keep the commands out of context until you type them; Codex does the same through each command's `agents/openai.yaml`.

| Skill | Covers | Loaded on demand |
|---|---|---|
| `vibe-plan` | Requirements, domain analysis, user/competitor/tech research, PRD, architecture, phases, dev tools (Context7, Playwright, Chrome DevTools, Figma, Supabase, GitHub, LSP) | domain-analysis, tech-research, dev-tools, 6 templates |
| `vibe-tasks` | Task cards with deps and touched files, progress, next task, resuming from a handoff ("continue") | split, `tasks.py`, templates, mini CRM example |
| `vibe-architecture` | Follow the codebase's conventions; pick an architecture that fits (modular monolith, layered, hexagonal, DDD, CQRS, events, microservices); SOLID, patterns, refactoring | codebase-conventions, architecture-styles, ddd, design-principles |
| `vibe-backend` | **Laravel, Spring Boot, ASP.NET Core and MySQL** next to Node/TypeScript and PostgreSQL; schema, indexes, transactions, safe migrations, 11 ORMs, multi-tenant + Postgres RLS, API contracts, auth, **permission models** (fixed roles, roles per tenant, per-module matrix, branch scope), native-app login, background jobs, app security, Vietnam personal data law, **payments** (VNPay, MoMo, VietQR, e-invoices), **Vietnamese search**, **email/Zalo/SMS delivery**, **realtime**, **Excel/CSV import** | data-layer, orm, multi-tenant, postgres-rls, isolation-tests, api-contract, api-conventions, auth, native-auth, permissions, jobs, app-security, privacy, payments, search, notifications, realtime, data-import, laravel, spring, dotnet, mysql |
| `vibe-frontend` | Web UI from mockups (Claude Design, Figma), motion, state (TanStack Query, Zustand, Redux, Pinia...), safe workspace switching, **Next.js Server Actions** and `'use cache'` per tenant, **i18n** (VND, time zones, plurals), **SEO for public pages** | design-to-code, motion-spec, state-management, server-actions, i18n, seo |
| `vibe-mobile` | iOS and Android: stack choice (Expo/React Native, Flutter, native, PWA), Keychain/Keystore tokens, offline outbox, push, deep links, tests (Jest, Maestro), EAS Build, OTA, store review, forced updates | choose-stack, app-data, platform-features, testing, release |
| `vibe-desktop` | Windows, macOS, Linux: Tauri / Electron / PWA, Electron security (isolation, sandbox, IPC sender checks), OS keychain tokens, Playwright tests, signing, notarization, auto-update | choose-stack, security, app-data, testing, release |
| `vibe-ai` | AI features in apps: Claude API from the server, structured output, streaming, prompt injection, tenant isolation, per-tenant budgets and usage, chat history, photos and PDFs, free tests, quality evals | design, integration, safety, cost, chat-and-files, testing |
| `vibe-build` | One agent writes code and tests per task, test levels, **Playwright UI and user-flow tests**, when to parallelize | testing, e2e-playwright, parallel, agent-brief |
| `vibe-review` | Evidence-based acceptance, independent verifier, PASS / PASS + follow-up / BLOCK; PASS merges the task | checklist, verifier · REVIEW template |
| `vibe-ship` | CI/CD, deploys with migrations in the right order, feature flags, **rollback**, monitoring, **backup and restore**, maintenance, **performance and load tests** (k6, slow queries, Web Vitals) | ci-cd, release-rollback, observability, backup-restore, maintenance, performance |
| `vibe-fix` | Bug fixes that start with a failing repro test, production incidents, suspected data leaks, postmortems | POSTMORTEM template |

| Subagent | When |
|---|---|
| `vibe-verifier` | Independent review: fresh context, read-only, runs checks and reads the diff without the author's reasoning. Without subagent support, the review skill uses a fresh session instead |
| `vibe-implementer` | Only for running several **large, independent** tasks in parallel, one git worktree each. By default the main session does the work |

## Progress lives in the repo, not in chat memory

<p align="center">
  <img src="assets/terminal.svg" width="90%" alt="Real output of tasks.py status and next on the mini-crm example: progress per phase, task in progress, ready tasks, tasks waiting on deps.">
</p>

Task cards are Markdown files in `docs/tasks/`, so any session on any machine can continue. `tasks.py` (Python 3.8+, no dependencies) checks deps, orders work (review first, then the lowest unfinished phase), never batches two tasks touching the same file or two schema migrations, exits 1 on card errors, and suggests exactly one next task. 49 unit tests run in CI on Python 3.8 and 3.12:

```bash
S=plugins/vibe/skills/vibe-tasks
python3 $S/scripts/tasks.py status --dir $S/examples/mini-crm
python3 $S/scripts/tasks.py next   --dir $S/examples/mini-crm
```

## Executed, not just written

Wrong examples in docs for real software do more harm than no docs. Code, SQL and workflows were run before they went in. Since 1.2.0 that code lives in [`verify/`](verify/) with its tests, and CI reruns it on every pull request from an empty database: 13 Node projects on PostgreSQL 16, the Laravel, Spring Boot, ASP.NET Core and MySQL projects (MySQL 8.4), the Expo app and the Electron app. 33 references are rendered from the tested files, so CI fails when a doc and its code drift apart.

| Area | How it was checked | Result |
|---|---|---|
| **Backend core (1.2.0)**: workers listing tenants, append-only tables, membership checks, role changes, API keys, native-app tokens, Idempotency-Key, double booking, permission models | vitest + Express 5 on PostgreSQL 16 (`FORCE` RLS), concurrent requests | 77 tests; found that under `FORCE` RLS a worker's `SELECT id FROM tenants` returns 0 rows (reminders silently did nothing), and that two owners demoting each other at once left none until owners were locked; 21 safeguards each fail a test |
| **Laravel 13 on MySQL (1.3.0)**: tenant scope, Policies, queues, booking, PostgreSQL RLS variant | PHPUnit 12 on MySQL 8.4 and 8.0, 10 PHP workers for the races | 67 tests; found that the `api` group resolves `{customer}` before the tenant middleware (another spa's customer came back with 200), that `unique:`/`exists:` rules ignore global scopes, and that new staff with no bookings deadlock under REPEATABLE READ (READ COMMITTED: 0 failures) |
| **Spring Boot 4.1 (1.3.0)**: tenant per transaction, Flyway roles, `@PreAuthorize`, N+1, reminder job | JUnit on PostgreSQL 16 (`FORCE` RLS), HikariCP | 57 tests; found that Spring Data query methods outside a transaction see 0 rows, that a session-level `SET` leaks through the pool, and that concurrent inserts can deadlock inside the exclusion constraint (now a per-staff advisory lock in every PostgreSQL stack) |
| **ASP.NET Core 10 + EF Core 10 (1.3.0)**: endpoint filter, query filters, pooling, migrations, `BackgroundService` | xUnit v3 through `WebApplicationFactory` on PostgreSQL 16 | 55 tests; found what skips EF query filters, that a pooled DbContext keeps the last request's tenant, and that `No Reset On Close=true` leaks the previous tenant |
| **MySQL 8.4 (1.3.0)**: isolation without RLS, Vietnamese search, time zones, online DDL, locking | node:test + mysql2 on 8.4.13 and 8.0.46, 200,000 customers | 61 tests; found that `utf8mb4_vi_0900_ai_ci` misses "nguyen" → "Nguyễn" while `utf8mb4_0900_ai_ci` matches, that one idle transaction makes an INSTANT `ALTER` wait with every new query queued behind it, and that SKIP LOCKED claims need a pinned index |
| Multi-tenant SQL: RLS, split read/write policies, composite FKs, per-request membership check, workspace lookup before login, Supabase | Run verbatim on PostgreSQL 16 as the app role, with cross-tenant attack attempts | Blocked correctly. Two holes in an earlier draft were fixed: an `OR` policy allowing cross-tenant writes, and a slug table writable by the app role |
| Backup and restore | `pg_dump` with the backup role, restore to a new cluster as a non-superuser admin, then check owners, RLS, row counts, next migration | 0 errors; found 2 real doc bugs (backup role missing grants on new tables; `ALTER DEFAULT PRIVILEGES` without `FOR ROLE`) |
| Playwright UI tests | 21 tests (roles, server/browser time, error mocks, screenshots, a11y), 5 repeats × 4 workers, on a normal app, an app that aborts requests on navigation, and one with a Next.js-style `role="alert"` | No flakes; the two workspace-switch tests fail every time on two deliberately broken apps |
| Tenant isolation tests | On a correct app and 3 broken ones (id leak, missing membership check, wrong path) | All 3 caught; the control caught a "passes without checking anything" test |
| 8 ORMs: Prisma 7, Drizzle, TypeORM, Sequelize, SQLAlchemy 2, Django, GORM, ActiveRecord | "Deduct stock + create order" on PostgreSQL 16: in stock, out of stock, two concurrent transactions | All 8 pass; found an overselling bug in an earlier draft |
| TypeScript examples (DDD, state, auth, webhooks, `426 app_update_required`) | `tsc --strict` + unit tests | Pass |
| Mobile, Expo SDK 58: guarded navigation, SecureStore tokens, API client, SQLite outbox, push, component tests, `app.config.ts`, `eas.json` | `tsc --strict`, Jest with a cold cache, `eas.json` through `eas-cli`'s own config reader, runtime version per variant | Pass; found draft bugs (TypeScript 6 types, Jest not exiting, cold-cache timeouts, a wrong OTA flow). 1.2.0: the offline queue keeps writes on 401 and 426 (it used to drop them), push devices fan out through memberships; 30 Jest tests and a SQL test, in CI |
| Desktop: Electron security (`app://` scheme, IPC sender checks, navigation blocking), `safeStorage`; Tauri capabilities, Rust command, updater | Electron 45 + Playwright 1.64 (100 consecutive runs) on a sample app and 8 deliberately misconfigured ones; real Tauri 2.12 build with signed updates | All 8 caught; found draft bugs (hanging navigation test, a traversal test that tested nothing, a flaky test, deprecated `safeStorage` API). 1.2.0: without permission handlers Electron 45 grants the camera and every other permission; `new URL('app://…').origin` is `'null'`, so the navigation guard blocked the app's own pages. Electron tests run in CI |
| AI features: Claude API, structured output, cancellable streaming, per-tenant budget and usage | `@anthropic-ai/sdk` 1.3 with a fake fetch, `tsc --strict`, usage table on PostgreSQL 16, safeguards removed one at a time | 24 tests; 15 safeguards each fail a test; found that the usage store read `tenants` outside tenant context, so under `FORCE` RLS every AI call was blocked. Evals against the real API were not run (no API key in the test environment) |
| Background jobs with pg-boss: reminders, retries, dead letter, schedules | pg-boss 12.38 on PostgreSQL 16 with `FORCE` RLS, real worker, fake SMS provider | 9 tests; workers list tenants with `app_tenant_ids()`; 6 removed safeguards each fail a test |
| Performance: `pg_stat_statements`, indexes, k6, Web Vitals | k6 1.8.2 against a sample API with 500,000 customers; Playwright + `web-vitals` 6 | The right index took p95 from 2.74 s to 1.97 ms at the same load; the budget test caught a page with CLS 0.23 |
| App security: SSRF guard, upload checks, rate limiting, secret scanning | Node 22, PostgreSQL 16, gitleaks 8.30 | 15 tests, including the tenant secret box; removing each SSRF layer fails a test; 50 parallel requests with a limit of 10 let exactly 10 through; gitleaks caught a planted key even after the file was deleted |
| Personal data: consent log, request deadlines | PostgreSQL 16 with RLS; deadline tests | 6 tests; found that a view without `security_invoker` (superuser owner) leaked tenant A's consents to tenant B; the consent log is append-only (`REVOKE`) |
| Payments: VNPay, MoMo, bank transfer webhooks, refunds | Signing compared with VNPay's and MoMo's official demo code; IPN and SePay webhook handlers on PostgreSQL 16 as the app role, with duplicate callbacks racing | 30 tests; 17 safeguards each fail a test (row lock, amount check, `07` → review, check character on transfer codes, `querydr` before resending a refund...); found that summing refunds inside the locking statement accepted 300,000 VND of refunds on a 200,000 VND payment. Not run against the real VNPay or MoMo sandboxes (no merchant account) |
| Vietnamese search: names without accents, phone numbers, notes | PostgreSQL 16 with 500,000 customers, measured as the app role | Found that under RLS `LIKE` cannot use the trigram index (380 ms on a 200,000-customer tenant); the `SECURITY DEFINER` search function takes 2–25 ms. 13 tests; 9 safeguards each fail a test |
| Notifications: one-click unsubscribe, Zalo token refresh, advertising limits, SMS parts | PostgreSQL 16, a fake Zalo that rotates refresh tokens | 9 tests; three concurrent refreshes use the refresh token once; three campaigns at once after two sends: exactly one more goes out; 8 safeguards each fail a test. Not sent through real Zalo or SMS providers |
| Realtime: SSE, LISTEN/NOTIFY, TanStack Query client | Two app instances on PostgreSQL 16 (`FORCE` RLS), real HTTP streams, jsdom client | 22 tests; a rolled-back write never emits; tenant A's events never reach B; 12 safeguards each fail a test |
| i18n: VND, dates in the tenant's time zone, catalogs, Vietnamese sorting | Node 22 ICU, PostgreSQL 16, next-intl 4.14 + Next.js 16 in Chromium with 3 time zones | 30 tests; found that `1.250.000 ₫` uses a no-break space, Postgres reads `'GMT+7'` as UTC−7, and formatting without a zone breaks hydration; 11 safeguards each fail a test |
| Excel/CSV import | exceljs 4.4 and csv-parse 7 on real .xlsx and CSV files, pg-boss 12.38, a worker killed mid-file | 21 tests; re-runs add no duplicates, a taken email no longer stalls the batch; found that reading exceljs `columnCount` per row made 50,000 rows take 432 s, and csv-parse's `delimiter_auto` breaks on Vietnamese text; 7 safeguards each fail a test |
| Next.js Server Actions and `'use cache'` per tenant (1.2.0) | `next build` + `next start`, posting to the actions over HTTP | 4 tests; found that a `'use cache'` function is also a server function: posted directly with another tenant's id, it returned that tenant's customers; 5 safeguards each fail a test |
| SEO for public pages | `next build` + `next start` (Next.js 16.4), fetched without a browser | 11 tests; found that a `loading.tsx` on the spa route turns 404 and 308 into 200, and that `next.config` headers are fixed at build time; 7 safeguards each fail a test |
| `tasks.py` (1.2.0) | 49 `unittest` cases on Python 3.8 and 3.12 | Found that an empty folder printed "All tasks done"; 12 safeguards each fail a test |
| GitHub Actions (CI, deploy, E2E, load test, security) | actionlint | Pass |
| Agent Skills format | `agentskills validate` (reference validator) on all 12 domain skills, in CI | Pass |

Not run here: the skills inside agents other than Claude Code (no Codex, Cursor, Copilot or Gemini sessions were available in the test environment). They follow the standard and pass its validator; please report issues.

## Evals: with and without the skills

`plugins/vibe/evals/` holds 31 cases: real requests (in Vietnamese, as users type them) with grading criteria. Most criteria are objective: which tools ran, in what order (the test is written and seen failing before the fix), file contents after the run, whether an agent was spawned. Each case runs 3 times with the skills and 3 times without (`claude plugin eval`, the command's default model and judge). Results for 1.2.0, run in Claude Code:

| Case | With | Without | Main difference |
|---|---|---|---|
| **New in 1.2.0:** "build me a spa management app" in an empty folder | **1.00** | 0.33 | Asked a numbered list of questions with defaults before any code: 3/3 vs 0/3 (without the skills it wrote the app straight away) |
| **New:** "do the permissions" when the PRD leaves them open | **1.00** | 0.67 | Offered 2–3 permission models with trade-offs and a recommendation, then asked: 3/3 vs 0/3 |
| **New:** review a branch with five planted issues | **1.00** | 0.95 | Missing `FORCE ROW LEVEL SECURITY`: 3/3 vs 2/3; the double-redeem race, `UNIQUE` without `tenant_id` and the missing composite FK were found both ways |
| **New:** "continue" with a handoff note and uncommitted work | **0.96** | 0.92 | Card handed over at `review`, not left at `doing` or set to `done`: 2/3 vs 1/3 |
| **New:** "it's done, tests pass, mark it done and merge" | 1.00 | 1.00 | Both runs found the two gaps and neither marked it done; kept as a guard |
| Live appointment board (realtime) | **1.00** | 0.40 | Events as hints, stream authorized per spa, one LISTEN connection per instance: 3/3 vs 0/3 each |
| Slow list page, team wants to add Redis | **1.00** | 0.44 | Load test with thresholds on staging: 3/3 vs 0/3 |
| Ship a mobile app that just added `expo-camera` via EAS Update | **1.00** | 0.50 | New build and staged rollout, old app versions kept working: 3/3 vs 0/3 |
| Fix `slugify('Đường')` | **1.00** | 0.58 | Saw the repro test fail before fixing: 3/3 vs 0/3 |
| Switching workspace still shows old data | **1.00** | 0.58 | Cancel requests and drop the old workspace's cache: 3/3 vs 0/3 |
| Import 20,000 customers from Excel/CSV | **1.00** | 0.60 | Resumable job in committed chunks; formula escaping and UTF-8 check: 3/3 vs 0/3 |
| Zalo reminders with SMS fallback, promotions | **1.00** | 0.60 | Refresh token rotation from one place; advertising rules: 3/3 vs 0/3 |
| Online deposits by QR transfer or VNPay | **1.00** | 0.60 | Edited transfer notes, partial payments, duplicate webhooks; e-invoice timing: 3/3 vs 0/3 |
| SEO for public spa pages, app and staging hidden | **1.00** | 0.60 | Real 404/308 for spa pages: 3/3 vs 0/3 |
| SMS reminder job design | **1.00** | 0.67 | How the scan lists spas under RLS (a narrow `SECURITY DEFINER` function, then per-spa work): 3/3 vs 0/3 (grader added in 1.2.0) |
| Customer asks to delete their data (Vietnam law) | **1.00** | 0.67 | Current law and deadlines: 3/3 vs 0/3 |
| Playwright test for workspace switching | **1.00** | 0.73 | Role/label locators: 3/3 vs 0/3 |
| "Where are we, what's next?" on task cards | **1.00** | 0.73 | The right next step: 3/3 vs 0/3 |
| AI feature: summarize customer notes | **1.00** | 0.75 | `max_tokens`, `stop_reason` check, friendly API errors: 3/3 vs 0/3 |
| Move mobile tokens out of AsyncStorage | **1.00** | 0.78 | Clear Keychain tokens left after a reinstall: 3/3 vs 0/3 |
| Pick an architecture for a 3-person team | **1.00** | 0.80 | When to revisit the choice: 3/3 vs 1/3 |
| Search "nguyen thao" finds "Nguyễn Thị Thảo" under RLS | **1.00** | 0.80 | Saw that RLS keeps LIKE off the trigram index: 3/3 vs 1/3 |
| Vietnamese/English, prices and times for a Singapore branch | **0.73** | 0.53 | "Today" bounded by local midnight: 2/3 vs 1/3; catalog check in CI: 0/3 both ways |
| Link preview (SSRF) | 0.92 | 0.92 | The skill was not loaded in any run |
| RLS for memberships | 0.93 | **1.00** | The one run that skipped the skill set the user id on every request (grader added in 1.2.0) |
| NOT NULL backfill under FORCE RLS, column rename without downtime, follow the codebase's patterns, Electron app security, parallel agents for small tasks? | 1.00 | 1.00 | Done right without the skills too |
| **Small change** ("rename the Save button"): no process docs, no agents | 1.00 | 1.00 | The skills don't add ceremony |
| **Mean of 31 cases** | **0.98** | 0.75 | The 26 cases from 1.1.0: 0.98 vs 0.74; the 5 new ones: 0.99 vs 0.77 |

Notes on this run:
- **Two graders rewritten.** In the two workflow cases the judge read a shortened trace and missed a passing test run, and misread an unchanged `status: review` card. Both checks became regex graders on the file or trace, and the two cases were rerun; their numbers are from the rerun.
- **Harder graders.** The reminder-job and memberships cases each gained a grader on 1.2.0 content, which is part of why the score without the skills fell from 0.80 to 0.74 on the 26 older cases.
- **Sandbox.** The eval sandbox blocks writes to `.git`, so runs that tried to commit reported it instead.

Compared with earlier versions (same settings):

| | 0.5.0 | 1.0.0 | 1.1.0 | 1.2.0 |
|---|---|---|---|---|
| Cases | 19 | 19 | 26 | 31 |
| Score with / without | 0.99 / 0.85 | 0.99 / 0.85 | 0.98 / 0.80 | 0.98 / 0.75 (the same 26 cases: 0.98 / 0.74) |
| Always-on tokens (`plugin details`) | 4,581 | 3,620 | 3,791 | 3,579, including about 340 for the 5 commands |
| Run cost with the skills, relative to without | 1.59× | 1.46× | 1.52× | 1.41× |
| Runs where the skill loaded | 42/54 | 44/54 | 60/75 | 82/90 |

The English skills trigger on Vietnamese requests, and the agent answers in Vietnamese. In Claude Code the five commands (`vibe-help`, `vibe-start`...) stay out of context until you type them.

The cost: the agent reads skill docs before answering, so a run costs about 1.4× a run without the skills (about $0.16 per run on average in these cases); a small change only pays for the skill descriptions. Re-run after every skill change (each run calls a real model and is billed to your account):

```bash
claude plugin eval ./plugins/vibe --runs 3 --no-publish --trust-plugin --scaffold --allow-tools "Bash" "Write" "Edit"
```

On Linux the eval sandbox needs `bubblewrap` and `socat` to run Bash.

## In your project

- `AGENTS.md` (from the plan skill): commands, conventions, rules. Every agent reads it.
- Small changes (a label, a color) are done directly: every skill has a "size it right" rule so it doesn't build process where none is needed.
- Three code rules apply to everything the agent writes, even when no skill loads (they sit in the `vibe-build` description and in `AGENTS.md`): logic about to appear a third time becomes one function at the lowest level its callers share, moving up as usage spreads; comments say why, never what; the project's libraries, the platform or a maintained library come before hand-written CSV, date, validation or retry code.
- Parallel agents are optional and need an agent that can run subagents or several sessions (Claude Code settings in `vibe-build`'s `references/parallel.md`).

<details>
<summary>Files the workflow creates</summary>

```text
AGENTS.md            commands, conventions, rules, stack notes (+ CLAUDE.md with @AGENTS.md)
docs/domain/         DOMAIN.md: glossary, roles, workflows, lifecycles, BR-xx rules
docs/research/       research notes, library comparisons, spike results
docs/plan/           PRD.md · ARCHITECTURE.md · PHASES.md
docs/privacy/        DATA-MAP.md: personal data, purposes, processors, retention
docs/contracts/      endpoints, sample payloads
docs/design/         design inventory, motion spec, verification screenshots
docs/tasks/          task cards, e.g. P1-T03-customers-api.md
docs/reviews/        review reports (P1-T03.md per task, P1.md per phase)
docs/releases/       release checklist + rollback plan
docs/postmortems/    incident postmortems
docs/STATUS.md       progress, decisions, risks
docs/HANDOFF.md      notes for the next session (archived to docs/handoffs/ once done)
```
</details>

<details>
<summary>Repository layout</summary>

```text
.claude-plugin/marketplace.json
assets/              README images + make_graphics.py
verify/              the code behind the references, with tests (CI from an empty PostgreSQL 16)
plugins/vibe/
├── .claude-plugin/plugin.json
├── agents/          vibe-verifier · vibe-implementer
├── evals/           eval cases (claude plugin eval)
└── skills/
    ├── vibe-plan/          domain-analysis, tech-research, dev-tools · templates PRD, ARCHITECTURE, PHASES, DOMAIN, RESEARCH, AGENTS
    ├── vibe-tasks/         split · scripts/tasks.py · templates task, STATUS, HANDOFF · examples/mini-crm
    ├── vibe-architecture/  codebase-conventions, architecture-styles, ddd, design-principles
    ├── vibe-backend/       data-layer, orm, multi-tenant, postgres-rls, isolation-tests, api-contract, api-conventions, auth, native-auth, permissions, jobs, app-security, privacy, payments, search, notifications, realtime, data-import, laravel, spring, dotnet, mysql
    ├── vibe-frontend/      design-to-code, motion-spec, state-management, server-actions, i18n, seo
    ├── vibe-mobile/        choose-stack, app-data, platform-features, testing, release
    ├── vibe-desktop/       choose-stack, security, app-data, testing, release
    ├── vibe-ai/            design, integration, safety, cost, chat-and-files, testing
    ├── vibe-build/         testing, e2e-playwright, parallel, agent-brief
    ├── vibe-review/        checklist, verifier · REVIEW template
    ├── vibe-ship/          ci-cd, release-rollback, observability, backup-restore, maintenance, performance · RELEASE template
    ├── vibe-fix/           POSTMORTEM template
    └── vibe-help/ vibe-start/ vibe-status/ vibe-next/ vibe-check/   commands (run only when typed; agents/openai.yaml for Codex)
```
</details>

## Contributing

- Read [CONTRIBUTING.md](CONTRIBUTING.md). Rule one: every example you add must run.
- Team-specific review checklist: `vibe-review/references/checklist.md`; API conventions: `vibe-backend/references/api-conventions.md`.
- Bump `version` in `plugins/vibe/.claude-plugin/plugin.json` for each release.
- Author: thaiphan ([@HoangThai18](https://github.com/HoangThai18)). MIT licensed.
