# Changelog

## 1.2.0

The code behind the references now lives in `verify/` and CI reruns it from an empty PostgreSQL 16 database on every pull request (13 projects, plus the Expo and Electron apps). 29 references are rendered from the tested files; CI fails when a doc and its code drift apart, or when a shared file's copies differ.

- **Workflow**:
  - One status flow: `/vibe-next` stops at `review` and keeps the task branch; `/vibe-check` PASS merges with `--no-ff` (or prints the PR commands) and sets `done`; BLOCK sends the card back to `doing`. A finished phase is closed with `/vibe-check phase P1`, then the next phase is split.
  - "Continue" ("tiếp tục", "làm tiếp đi") resumes from `docs/HANDOFF.md` and `git status` and does the next step, instead of only proposing it.
  - `tasks.py`: no more "All tasks done" on an empty folder; card errors, empty folders and unknown phases exit 1; reviews come first, then the lowest unfinished phase; two schema tasks never run in parallel. Parser fixes for multi-line lists, `[id].tsx` and `[WIP]` titles. 49 unit tests on Python 3.8 and 3.12.
  - Commands work in other agents: a path to `tasks.py` that doesn't depend on Claude Code, and `agents/openai.yaml` so Codex runs them only when typed. The verifier brief works without the plugin (`vibe-review/references/verifier.md`).
  - `vibe-build` sets up git and the phase branch, adds a safety net and forbids weakening tests; `vibe-fix` stops after two failed attempts; `vibe-ship` keeps production secrets out of the agent session.
- **Choosing with the user**: `vibe-plan` and `vibe-backend` offer 2–3 options with trade-offs and a recommendation, and ask, when the project docs don't settle the permission model, tenancy, auth method or payment provider; the choice becomes an ADR.
- **`vibe-backend`**:
  - New `permissions.md`: fixed roles, roles each tenant defines, a per-module permission matrix (bitmask), data scope (own / branch / tenant) and policy engines, with tested code: no privilege escalation through role edits, the owner role kept, permissions reloaded per request, branch scope in RLS.
  - Workers list tenants with `app_tenant_ids()`. Under `FORCE` RLS a plain `SELECT FROM tenants` returned 0 rows, so reminders and every per-tenant job silently did nothing.
  - The membership check filters on the current tenant and sets `app.actor_id` / `app.member_role`; audit log, consents and global tables revoke writes from the app role, with a CI query.
  - One example schema with tenant-first keys and composite foreign keys; an exclusion constraint against double booking.
  - Native-app login moves to `native-auth.md` (rotating refresh tokens with reuse detection, Apple/Google ID tokens with a nonce), which keeps `auth.md` at 21 KB instead of 36 KB. Role changes lock owners and keep one; API keys are bound to the path tenant; NIST 800-63B-4 password lengths; a server-side Idempotency-Key.
  - Payments: VNPay `07` goes to review; refunds can't pay out twice, even across midnight; transfer codes carry a check character; merchant credentials are sealed.
  - Notifications: advertising limits hold under concurrent campaigns; one-click unsubscribe accepts any signed POST; Zalo tokens are sealed. Import rejects duplicate or taken emails instead of stalling. Realtime filters membership by tenant.
  - Tenant secrets: one AES-256-GCM secret box with keys outside the database and a `key_version` for rotation; in-country data storage (Decree 53/2022, Law 116/2025).
- **`vibe-frontend`**: new `server-actions.md`. A `'use cache'` function is also a server function, so posting it another tenant's id returned that tenant's data: never import one into client code. A time zone picker from `pg_timezone_names`; SEO prices through `formatMoney`.
- **`vibe-ai`**:
  - Streamed drafts report `refused` and `truncated`.
  - The eval script runs from any path and fails when zero cases ran.
  - Usage recording never fails after a billed call and works under `FORCE` RLS. Before this fix, every AI call was blocked.
  - Caching advice corrected.
  - An endpoint-level cross-tenant test.
  - New `chat-and-files.md`: stored chat history, photos and PDFs.
- **`vibe-mobile`**:
  - The offline queue keeps writes on 401 and 426. It used to drop them.
  - Token refresh follows the backend contract.
  - The fresh-install Keychain wipe no longer signs out users after an update.
  - Push devices fan out through memberships.
  - Selling on the web only, the Google Play closed test, and Zalo Mini App.
- **`vibe-desktop`**:
  - Electron permission handlers that deny by default. Without them, Electron 45 grants the camera and every other permission.
  - A navigation guard that no longer blocks the app's own `app://` pages.
  - Version and platform headers with 426.
  - Windows signing through a cloud HSM.
  - Tauri capability reduced to `core:default`.
- **Evals**, 31 cases: 0.98 with the skills vs 0.75 without. Five are new (planning a new app, choosing a permission model, reviewing a branch, continuing from a handoff, refusing an unproven "done") and score 0.99 vs 0.77. The reminder-job and memberships cases gained graders on 1.2.0 content. A run with the skills costs 1.41× a run without (1.52× in 1.1.0).
- **Tokens**: always-on skill descriptions 3,791 → 3,579 (Claude Code `plugin details`, including about 340 for the 5 commands).

## 1.1.0

New references, each with code that was run (tests, and safeguards removed one at a time to confirm a test fails):

- `vibe-backend`:
  - `payments.md`: VNPay (signing as in the official demo, IPN), MoMo, bank transfer with VietQR and SePay webhooks, refunds, reconciliation, e-invoices under Decree 254/2026, subscriptions.
  - `search.md`: accent-insensitive search for Vietnamese names and phone numbers, and full-text search for notes. It covers why `LIKE` cannot use a trigram index under RLS, and a `SECURITY DEFINER` fix (380 ms → 9 ms on a 200,000-customer tenant).
  - `notifications.md`: email deliverability and one-click unsubscribe; Zalo ZBS template messages (formerly ZNS) with a token refresh lease; SMS brandname and advertising rules; OTP abuse.
- `vibe-backend`: `realtime.md` (SSE, Postgres LISTEN/NOTIFY fan-out, tenant isolation) and `data-import.md` (Excel/CSV import with row errors, re-runnable without duplicates).
- `vibe-frontend`: `i18n.md` (VND, dates in the tenant's time zone, plurals, Vietnamese sorting) and `seo.md` (public pages vs noindex app, metadata, sitemap, JSON-LD, hreflang).
- New eval cases: payments design, Vietnamese search, Zalo/SMS notifications, and one each for realtime, import, i18n and SEO.
- Evals, 26 cases: 0.98 with the skills vs 0.80 without; the 7 new cases score 0.97 vs 0.64. Always-on skill descriptions: 3,620 → 3,791 tokens.
- `vibe-frontend`: new core rule, one formatting module with explicit locale and time zone, and a catalog check in CI.
- `vibe-mobile`: routes multiple languages, money and date formatting to the `vibe-frontend` i18n reference (Expo + i18next).

## 1.0.0

- Skills rewritten in English for any agent that supports the open Agent Skills standard: Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, OpenCode and others. Agents still answer in the user's language.
- Skills renamed with a `vibe-` prefix (`/vibe:start` → `/vibe-start`). `AGENTS.md` is the project instructions file; `CLAUDE.md` imports it.
- Always-on skill descriptions: 4,581 → 3,620 tokens. SKILL.md bodies: about 25% shorter.
- CI validates the skills against the Agent Skills spec.

## 0.5.0

- `ai` skill: LLM features in apps (Claude API, structured output, streaming, prompt injection, per-tenant budgets, evals).
- Background jobs, performance and load testing, app security, and Vietnamese personal data law references.
- Shortcut commands: start, status, next, check, help.

## 0.4.0

- Mobile (Expo/React Native, Flutter) and desktop (Tauri, Electron) skills.

## 0.3.0

- First public release: plan, tasks, architecture, backend, frontend, build, review, ship and fix skills, with the task-card workflow.
