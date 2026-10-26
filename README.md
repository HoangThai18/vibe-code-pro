<p align="center">
  <img src="assets/hero.svg" width="100%" alt="vibe: Agent Skills for shipping real software. 12 skills: plan, tasks, architecture, backend, frontend, mobile, desktop, ai, build, review, ship, fix. Works with Claude Code, Codex, Cursor, Copilot, Gemini CLI and OpenCode.">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-7C3AED?style=flat-square"></a>
  <a href="https://agentskills.io"><img alt="Agent Skills standard" src="https://img.shields.io/badge/Agent%20Skills-standard-0891B2?style=flat-square"></a>
  <img alt="12 skills, 5 commands, 2 subagents" src="https://img.shields.io/badge/skills-12%20·%20commands%205%20·%20subagents%202-DB2777?style=flat-square">
  <img alt="Examples executed" src="https://img.shields.io/badge/examples-executed-059669?style=flat-square">
  <a href="#evals-with-and-without-the-skills"><img alt="Eval: 0.98 with the skills vs 0.80 without, 26 cases" src="https://img.shields.io/badge/eval-0.98%20with%20·%200.80%20without-F59E0B?style=flat-square"></a>
</p>

<p align="center"><b>English</b> · <a href="README.vi.md">Tiếng Việt</a></p>

Vibe coding is fast. Real software needs what prompts tend to forget: getting the domain right, tests that ship with the code, one customer's data never leaking to another, migrations that don't break the running version, a rollback path, backups that were actually restored. **vibe** packs that experience into 12 [Agent Skills](https://agentskills.io) for web, mobile (iOS, Android), desktop (Windows, macOS, Linux) and AI features. Your agent picks the right skill from what you say and reads only the part it needs.

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
| `/vibe-next [P1-T03]` | Do the next task (or that one): code with tests, update the task card |
| `/vibe-check` | Before merging: tests, independent review, PASS or BLOCK |
| `/vibe-fix <bug>` | Fix a bug or a production incident |
| `/vibe-ship <task>` | Deploy, rollback, backup, monitoring |
| `/vibe-help` | Command table and a suggestion based on the project's state |

A loop: `/vibe-start` → `/vibe-next` → `/vibe-check` → merge → `/vibe-next`. You can also just talk: *"plan a booking app for spas"*, *"where are we?"*, *"continue"*, *"500 error when creating a customer"*.

**Upgrading from 0.x**: every skill now has a `vibe-` prefix (`/vibe:start` → `/vibe-start`, `/vibe:check` → `/vibe-check`) and the skills are in English. New projects get `AGENTS.md`; an existing `CLAUDE.md` is kept and gains an `@AGENTS.md` line. Task cards and `docs/` need no change. Update with `claude plugin update vibe`, or run `npx skills add HoangThai18/vibe-code-pro` again.

## Workflow

<p align="center">
  <img src="assets/flow.svg" width="100%" alt="Idea → plan → tasks → build → review → ship → live. Build uses the architecture, backend, frontend, mobile, desktop and ai skills. Bugs go to fix, then back to tasks.">
</p>

Following Anthropic's guidance for agents: **one main agent + skills + tools**. Knowledge lives in skills and loads on demand; subagents only where they pay off (independent review, large independent tasks in parallel). Every session carries only the short skill descriptions: about **3.8k tokens** for the 12 skills and 2 subagents (Claude Code's `plugin details` estimate). The 5 commands cost nothing until you type them in agents that honor `disable-model-invocation` (Claude Code, VS Code Copilot, Cursor).

| Skill | Covers | Loaded on demand |
|---|---|---|
| `vibe-plan` | Requirements, domain analysis, user/competitor/tech research, PRD, architecture, phases, dev tools (Context7, Playwright, Chrome DevTools, Figma, Supabase, GitHub, LSP) | domain-analysis, tech-research, dev-tools, 7 templates |
| `vibe-tasks` | Task cards with deps and touched files, progress, next task, handoff between sessions | `tasks.py`, templates, mini CRM example |
| `vibe-architecture` | Follow the codebase's conventions; pick an architecture that fits (modular monolith, layered, hexagonal, DDD, CQRS, events, microservices); SOLID, patterns, refactoring | codebase-conventions, architecture-styles, ddd, design-principles |
| `vibe-backend` | Schema, indexes, transactions, safe migrations, 8 ORMs, multi-tenant + Postgres RLS, API contracts, auth, background jobs, app security, Vietnam personal data law, **payments** (VNPay, MoMo, VietQR, e-invoices), **Vietnamese search**, **email/Zalo/SMS delivery**, **realtime**, **Excel/CSV import** | data-layer, orm, multi-tenant, postgres-rls, isolation-tests, api-contract, api-conventions, auth, jobs, app-security, privacy, payments, search, notifications, realtime, data-import |
| `vibe-frontend` | Web UI from mockups (Claude Design, Figma), motion, state (TanStack Query, Zustand, Redux, Pinia...), safe workspace switching, **i18n** (VND, time zones, plurals), **SEO for public pages** | design-to-code, motion-spec, state-management, i18n, seo |
| `vibe-mobile` | iOS and Android: stack choice (Expo/React Native, Flutter, native, PWA), Keychain/Keystore tokens, offline outbox, push, deep links, tests (Jest, Maestro), EAS Build, OTA, store review, forced updates | choose-stack, app-data, platform-features, testing, release |
| `vibe-desktop` | Windows, macOS, Linux: Tauri / Electron / PWA, Electron security (isolation, sandbox, IPC sender checks), OS keychain tokens, Playwright tests, signing, notarization, auto-update | choose-stack, security, app-data, testing, release |
| `vibe-ai` | AI features in apps: Claude API from the server, structured output, streaming, prompt injection, tenant isolation, per-tenant budgets and usage, free tests, quality evals | design, integration, safety, cost, testing |
| `vibe-build` | One agent writes code and tests per task, test levels, **Playwright UI and user-flow tests**, when to parallelize | testing, e2e-playwright, parallel, agent-brief |
| `vibe-review` | Evidence-based acceptance, independent verifier, PASS / BLOCK, report | checklist |
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

Task cards are Markdown files in `docs/tasks/`, so any session on any machine can continue. `tasks.py` (Python 3.8+, no dependencies) checks deps, orders work, flags two tasks touching the same file and suggests exactly one next task:

```bash
S=plugins/vibe/skills/vibe-tasks
python3 $S/scripts/tasks.py status --dir $S/examples/mini-crm
python3 $S/scripts/tasks.py next   --dir $S/examples/mini-crm
```

## Executed, not just written

Wrong examples in docs for real software do more harm than no docs. Code, SQL and workflows were run before they went in. In 1.0.0 the prose was translated; code blocks are unchanged except comments and test titles (checked block by block).

| Area | How it was checked | Result |
|---|---|---|
| Multi-tenant SQL: RLS, split read/write policies, composite FKs, per-request membership check, workspace lookup before login, Supabase | Run verbatim on PostgreSQL 16 as the app role, with cross-tenant attack attempts | Blocked correctly. Two holes in an earlier draft were fixed: an `OR` policy allowing cross-tenant writes, and a slug table writable by the app role |
| Backup and restore | `pg_dump` with the backup role, restore to a new cluster as a non-superuser admin, then check owners, RLS, row counts, next migration | 0 errors; found 2 real doc bugs (backup role missing grants on new tables; `ALTER DEFAULT PRIVILEGES` without `FOR ROLE`) |
| Playwright UI tests | 21 tests (roles, server/browser time, error mocks, screenshots, a11y), 5 repeats × 4 workers, on a normal app, an app that aborts requests on navigation, and one with a Next.js-style `role="alert"` | No flakes; the two workspace-switch tests fail every time on two deliberately broken apps |
| Tenant isolation tests | On a correct app and 3 broken ones (id leak, missing membership check, wrong path) | All 3 caught; the control caught a "passes without checking anything" test |
| 8 ORMs: Prisma 7, Drizzle, TypeORM, Sequelize, SQLAlchemy 2, Django, GORM, ActiveRecord | "Deduct stock + create order" on PostgreSQL 16: in stock, out of stock, two concurrent transactions | All 8 pass; found an overselling bug in an earlier draft |
| TypeScript examples (DDD, state, auth, webhooks, `426 app_update_required`) | `tsc --strict` + unit tests | Pass |
| Mobile, Expo SDK 58: guarded navigation, SecureStore tokens, API client, SQLite outbox, push, component tests, `app.config.ts`, `eas.json` | `tsc --strict`, Jest with a cold cache, `eas.json` through `eas-cli`'s own config reader, runtime version per variant | Pass; found draft bugs (TypeScript 6 types, Jest not exiting, cold-cache timeouts, a wrong OTA flow) |
| Desktop: Electron security (`app://` scheme, IPC sender checks, navigation blocking), `safeStorage`; Tauri capabilities, Rust command, updater | Electron 45 + Playwright 1.64 (100 consecutive runs) on a sample app and 8 deliberately misconfigured ones; real Tauri 2.12 build with signed updates | All 8 caught; found draft bugs (hanging navigation test, a traversal test that tested nothing, a flaky test, deprecated `safeStorage` API) |
| AI features: Claude API, structured output, cancellable streaming, per-tenant budget and usage | `@anthropic-ai/sdk` 1.3 with a fake fetch, `tsc --strict`, usage table on PostgreSQL 16, safeguards removed one at a time | Pass; removing any of 5 safeguards fails a test. Evals against the real API were not run (no API key in the test environment) |
| Background jobs with pg-boss: reminders, retries, dead letter, schedules | pg-boss 12.38 on PostgreSQL 16 with `FORCE` RLS, real worker, fake SMS provider | 6 tests pass; 4 removed safeguards each fail a test |
| Performance: `pg_stat_statements`, indexes, k6, Web Vitals | k6 1.8.2 against a sample API with 500,000 customers; Playwright + `web-vitals` 6 | The right index took p95 from 2.74 s to 1.97 ms at the same load; the budget test caught a page with CLS 0.23 |
| App security: SSRF guard, upload checks, rate limiting, secret scanning | Node 22, PostgreSQL 16, gitleaks 8.30 | 12 tests pass; removing each SSRF layer fails a test; 50 parallel requests with a limit of 10 let exactly 10 through; gitleaks caught a planted key even after the file was deleted |
| Personal data: consent log, request deadlines | PostgreSQL 16 with RLS; deadline tests | Pass; found that a view without `security_invoker` (superuser owner) leaked tenant A's consents to tenant B |
| Payments: VNPay, MoMo, bank transfer webhooks, refunds | Signing compared with VNPay's and MoMo's official demo code; IPN and SePay webhook handlers on PostgreSQL 16 as the app role, with duplicate callbacks racing | 18 tests pass; removing any of 6 safeguards (row lock, amount check, `vnp_TransactionStatus` check, duplicate-delivery check...) fails a test. Not run against the real VNPay or MoMo sandboxes (no merchant account) |
| Vietnamese search: names without accents, phone numbers, notes | PostgreSQL 16 with 500,000 customers, measured as the app role | Found that under RLS `LIKE` cannot use the trigram index (380 ms on a 200,000-customer tenant); the `SECURITY DEFINER` search function takes 2–25 ms. 13 tests; 9 safeguards each fail a test |
| Notifications: one-click unsubscribe, Zalo token refresh, advertising limits, SMS parts | PostgreSQL 16, a fake Zalo that rotates refresh tokens | 6 tests; three concurrent refreshes use the refresh token once; 6 safeguards each fail a test. Not sent through real Zalo or SMS providers |
| Realtime: SSE, LISTEN/NOTIFY, TanStack Query client | Two app instances on PostgreSQL 16 (`FORCE` RLS), real HTTP streams, jsdom client | 21 tests; a rolled-back write never emits; tenant A's events never reach B; 11 safeguards each fail a test |
| i18n: VND, dates in the tenant's time zone, catalogs, Vietnamese sorting | Node 22 ICU, PostgreSQL 16, next-intl 4.14 + Next.js 16 in Chromium with 3 time zones | 32 tests; found that `1.250.000 ₫` uses a no-break space, Postgres reads `'GMT+7'` as UTC−7, and formatting without a zone breaks hydration; 11 safeguards each fail a test |
| Excel/CSV import | exceljs 4.4 and csv-parse 7 on real .xlsx and CSV files, pg-boss 12.38, a worker killed mid-file | 19 tests; re-runs add no duplicates; found that reading exceljs `columnCount` per row made 50,000 rows take 432 s, and csv-parse's `delimiter_auto` breaks on Vietnamese text; 7 safeguards each fail a test |
| SEO for public pages | `next build` + `next start` (Next.js 16.4), fetched without a browser | 11 tests; found that a `loading.tsx` on the spa route turns 404 and 308 into 200, and that `next.config` headers are fixed at build time; 7 safeguards each fail a test |
| GitHub Actions (CI, deploy, E2E, load test, security) | actionlint | Pass |
| Agent Skills format | `agentskills validate` (reference validator) on all 12 domain skills, in CI | Pass |

Not run here: the skills inside agents other than Claude Code (no Codex, Cursor, Copilot or Gemini sessions were available in the test environment). They follow the standard and pass its validator; please report issues.

## Evals: with and without the skills

`plugins/vibe/evals/` holds 26 cases: real requests (in Vietnamese, as users type them) with grading criteria. Most criteria are objective: which tools ran, in what order (the test is written and seen failing before the fix), file contents after the run, whether an agent was spawned. Each case runs 3 times with the skills and 3 times without (`claude plugin eval`, the command's default model and judge). Results for 1.1.0, run in Claude Code:

| Case | With | Without | Main difference |
|---|---|---|---|
| **New in 1.1.0:** live appointment board (realtime) | **1.00** | 0.53 | Stream authorized per spa, with a test that one spa's events never reach another: 3/3 vs 0/3; one LISTEN connection per instance, streams end when a member is removed: 3/3 vs 0/3 |
| **New:** import 20,000 customers from Excel/CSV | **1.00** | 0.60 | Resumable job in committed chunks with tenant context: 3/3 vs 0/3; formula escaping in exported CSV and UTF-8 check: 3/3 vs 0/3 |
| **New:** Zalo reminders with SMS fallback, promotions | **1.00** | 0.60 | Zalo refresh token rotates, refresh from one place: 3/3 vs 0/3; advertising rules (consent, 07:00–22:00, 3 per 24 h): 3/3 vs 0/3 |
| **New:** SEO for public spa pages, app and staging hidden | **1.00** | 0.60 | Real 404/308 for spa pages, no `loading.tsx` around the lookup: 3/3 vs 0/3; staging noindex decided at runtime: 3/3 vs 1/3 |
| **New:** online deposits by QR transfer or VNPay | **1.00** | 0.73 | Edited transfer notes, partial payments, duplicate webhooks: 3/3 vs 0/3 |
| **New:** Vietnamese/English, prices and times for a Singapore branch | **0.80** | 0.60 | "Today" bounded by local midnight with a test at 16:59:59Z/17:00:00Z: 3/3 vs 0/3; catalog check in CI: 1/3 vs 0/3 |
| **New:** search "nguyen thao" finds "Nguyễn Thị Thảo" under RLS | **1.00** | 0.80 | Saw that RLS keeps LIKE off the trigram index and handled it: 3/3 vs 1/3 |
| Slow list page, team wants to add Redis | **1.00** | 0.56 | Load test with thresholds on staging: 3/3 vs 0/3 |
| Fix `slugify('Đường')` | **1.00** | 0.67 | Saw the repro test fail before fixing: 3/3 vs 1/3 |
| Ship a mobile app that just added `expo-camera` via EAS Update | **1.00** | 0.67 | New build, test first, staged rollout, camera permission declared: 3/3 vs 0/3 |
| Customer asks to delete their data (Vietnam law) | **1.00** | 0.67 | Current law and deadlines (acknowledge in 2 working days, delete in 20 days): 3/3 vs 0/3 |
| AI feature: summarize customer notes | **1.00** | 0.75 | `max_tokens`, `stop_reason` check, API errors become friendly messages: 3/3 vs 0/3 |
| Switching workspace still shows old data | **1.00** | 0.75 | Cancel requests and drop the old workspace's cache: 3/3 vs 0/3 |
| Move mobile tokens out of AsyncStorage | **0.94** | 0.78 | Clear Keychain tokens left over after a reinstall: 2/3 vs 0/3 (the run that missed it did not load the skill) |
| "Where are we, what's next?" on task cards | **1.00** | 0.80 | Reports progress from the cards: 3/3 vs 1/3 |
| Playwright test for workspace switching | **1.00** | 0.80 | Role/label locators: 3/3 vs 0/3 |
| Pick an architecture for a 3-person team | **1.00** | 0.93 | Boundaries enforced by a tool: 3/3 vs 2/3 |
| Electron app security | 0.96 | **1.00** | One run with the skills failed the renderer check (the grader found no renderer file at the expected path) |
| Link preview (SSRF) | 0.92 | **1.00** | The skill was not loaded in any run; one run's address checks were judged incomplete |
| NOT NULL backfill under FORCE RLS, RLS for memberships, column rename without downtime, follow the codebase's patterns, parallel agents for small tasks?, reminder job design | 1.00 | 1.00 | Done right without the skills too |
| **Small change** ("rename the Save button"): no process docs, no agents | 1.00 | 1.00 | The skills don't add ceremony |
| **Mean of 26 cases** | **0.98** | 0.80 | The 7 new cases: 0.97 vs 0.64 |

Notes on this run:
- **Cases rerun.** It stopped at the 30-minute limit, so the last 6 cases were rerun separately.
- **i18n case.** Two graders were reworded after the first run: one failed correct answers that named the old buggy query as the cause, and one demanded two things at once. The frontend skill also got one rule line; the i18n case's numbers are from the rerun.
- **Payments case.** An earlier version asked the agent to fix an obviously broken VNPay IPN handler. It scored 1.00 with and without the skills, so it was replaced by the design case above.

Compared with earlier versions (same settings):

| | 0.5.0 | 1.0.0 | 1.1.0 |
|---|---|---|---|
| Cases | 19 | 19 | 26 |
| Score with / without | 0.99 / 0.85 | 0.99 / 0.85 | 0.98 / 0.80 (the same 19 cases: 0.99 / 0.86) |
| Skill descriptions always in context | 4,581 tokens | 3,620 | 3,791 (7 new references cost 171 tokens) |
| Run cost with the skills, relative to without | 1.59× | 1.46× | 1.52× |
| Runs where the skill loaded | 42/54 | 44/54 | 60/75 |

The English skills trigger on Vietnamese requests, and the agent answers in Vietnamese. In Claude Code the five commands (`vibe-help`, `vibe-start`...) stay out of context until you type them.

The cost: the agent reads skill docs before answering, so a run costs about 1.5× a run without the skills (about $0.16 per run on average in these cases); a small change only pays for the skill descriptions. Re-run after every skill change (each run calls a real model and is billed to your account):

```bash
claude plugin eval ./plugins/vibe --runs 3 --no-publish --trust-plugin --scaffold --allow-tools "Bash" "Write" "Edit"
```

On Linux the eval sandbox needs `bubblewrap` and `socat` to run Bash.

## In your project

- `AGENTS.md` (from the plan skill): commands, conventions, rules. Every agent reads it.
- Small changes (a label, a color) are done directly: every skill has a "size it right" rule so it doesn't build process where none is needed.
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
docs/reviews/        review reports
docs/releases/       release checklist + rollback plan
docs/postmortems/    incident postmortems
docs/STATUS.md       progress, decisions, risks
docs/HANDOFF.md      notes for the next session
```
</details>

<details>
<summary>Repository layout</summary>

```text
.claude-plugin/marketplace.json
assets/              README images + make_graphics.py
plugins/vibe/
├── .claude-plugin/plugin.json
├── agents/          vibe-verifier · vibe-implementer
├── evals/           eval cases (claude plugin eval)
└── skills/
    ├── vibe-plan/          domain-analysis, tech-research, dev-tools · templates PRD, ARCHITECTURE, PHASES, DOMAIN, RESEARCH, AGENTS
    ├── vibe-tasks/         scripts/tasks.py · templates task, STATUS, HANDOFF · examples/mini-crm
    ├── vibe-architecture/  codebase-conventions, architecture-styles, ddd, design-principles
    ├── vibe-backend/       data-layer, orm, multi-tenant, postgres-rls, isolation-tests, api-contract, api-conventions, auth, jobs, app-security, privacy, payments, search, notifications, realtime, data-import
    ├── vibe-frontend/      design-to-code, motion-spec, state-management, i18n, seo
    ├── vibe-mobile/        choose-stack, app-data, platform-features, testing, release
    ├── vibe-desktop/       choose-stack, security, app-data, testing, release
    ├── vibe-ai/            design, integration, safety, cost, testing
    ├── vibe-build/         testing, e2e-playwright, parallel, agent-brief
    ├── vibe-review/        checklist
    ├── vibe-ship/          ci-cd, release-rollback, observability, backup-restore, maintenance, performance · RELEASE template
    ├── vibe-fix/           POSTMORTEM template
    └── vibe-help/ vibe-start/ vibe-status/ vibe-next/ vibe-check/   commands (run only when typed)
```
</details>

## Contributing

- Read [CONTRIBUTING.md](CONTRIBUTING.md). Rule one: every example you add must run.
- Team-specific review checklist: `vibe-review/references/checklist.md`; API conventions: `vibe-backend/references/api-conventions.md`.
- Bump `version` in `plugins/vibe/.claude-plugin/plugin.json` for each release.
- Author: thaiphan ([@HoangThai18](https://github.com/HoangThai18)). MIT licensed.
