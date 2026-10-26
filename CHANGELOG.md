# Changelog

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
