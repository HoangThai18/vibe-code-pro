---
name: vibe-plan
description: "Plan a project before coding: domain analysis (roles, workflows, business rules, data lifecycles), user, competitor and tech-stack research, PRD, platform choice (web, mobile, desktop), architecture, phases, AGENTS.md. Use when starting a product, system or large feature, including requests to build a whole new app, or when the domain is still vague; a small prototype gets a one-page plan. Also use for Vietnamese requests like 'làm cho mình app ...', 'xây hệ thống ...', 'lên plan', 'phân tích nghiệp vụ', 'viết PRD', 'chọn tech stack', 'chia phase'."
---

# Plan: from idea to a buildable plan

Paths under `references/` and `templates/` are relative to this skill's folder; read a file only when its step needs it.

Goal: before the first line of code, have docs that let a new engineer or agent understand what to build, for whom, under which business rules, with what technology, in what order. The costliest vibe-coding bug is code that is technically right but wrong for the business; most of those are caught here.

This skill writes no application code. It complements an agent's plan mode (if any): plan mode covers one change, this skill covers the whole project and saves the result as files in the repo.

Write project docs in the user's language unless the repo already uses another.

## Size it right

- **Prototype, demo, small tool**: one file `docs/plan/PLAN.md` (goal, scope, stack, 3–5 steps as `- [ ]` checkboxes, ticked as each is done). Ask the user before doing the full version.
- **Real product, many roles, many customers**: do every step below. Skip a step that doesn't apply (e.g. a trivial domain) with a one-line reason.

## Workflow

1. **Clarify requirements (1–2 rounds of questions).** Read what the user gave; if the repo has code, survey it first (structure, packages, schema, tests, CI). Ask one numbered list, each question with a default so the user can answer fast: users and roles, platform (web, mobile app, desktop app), 3–5 main flows, AI features?, personal or sensitive data (health, finance, children)?, scale and whether many customers share the system, constraints (stack, deadline, budget, legal), integrations, out of scope.
2. **Domain analysis** → `docs/domain/DOMAIN.md` from `templates/DOMAIN.md`. Read `references/domain-analysis.md`. This fixes terminology, rules and data lifecycles; every later step builds on it.
3. **Research** → `docs/research/<topic>.md` from `templates/RESEARCH.md`. Read `references/tech-research.md`. Two kinds: users/competitors (features the industry treats as standard) and technical (stack, libraries, services; read the docs for the exact version).
4. **PRD** → `docs/plan/PRD.md` from `templates/PRD.md`: problem, roles, measurable goals, main flows with acceptance criteria, scope, non-functional requirements, assumptions. One to two pages.
5. **Architecture** → `docs/plan/ARCHITECTURE.md` from `templates/ARCHITECTURE.md`:
   - Boring technology first; every added component (queue, cache, search, microservice) must answer "what breaks if we remove it?".
   - Platform: web by default; for a mobile or desktop app, choose the approach with the `vibe-mobile` skill (`references/choose-stack.md`) and the `vibe-desktop` skill (`references/choose-stack.md`). Installed apps bring store releases, code signing, and an API that must stay compatible with old versions: record this in an ADR from the start.
   - Choose the architecture style by team size and domain complexity (the `vibe-architecture` skill, `references/architecture-styles.md`); default to a modular monolith, split out services only for a measured reason. For a complex domain also read `references/ddd.md` in that skill.
   - AI features: choose the pattern and estimate monthly cost (the `vibe-ai` skill, `references/design.md`, `references/cost.md`). Personal data: create `docs/privacy/DATA-MAP.md` (the `vibe-backend` skill, `references/privacy.md` section 2), since sensitive data and services hosted abroad bring legal obligations. Performance targets are numbers (the `vibe-ship` skill, `references/performance.md` section 1).
   - Draft the data model from the entities in DOMAIN.md. If many customers share the system, choose the tenancy model now (the `vibe-backend` skill, `references/multi-tenant.md`); changing it later is very expensive.
   - Settle hard-to-reverse decisions early (tenancy, auth, ID format, money, time, deployment) in the ADR table, with reasons and rejected options.
6. **Phases** → `docs/plan/PHASES.md` from `templates/PHASES.md`:
   - P0 is the foundation: repo, lint/test/CI, auth, tenancy, layout, **deployable to staging** (the `vibe-ship` skill). Later phases build on it.
   - Each later phase is a vertical slice (DB → API → UI) for one user flow, ending in something demoable and deployable; never "BE done" then "FE done".
   - Each phase has a goal, scope, verifiable exit criteria, screens to design, risks; about 5–15 tasks.
7. **`AGENTS.md`** from `templates/AGENTS.template.md`: commands, structure, mandatory rules, conventions. Also create a `CLAUDE.md` whose only line is `@AGENTS.md` (Claude Code reads CLAUDE.md). If either file exists, extend it, never overwrite (an existing `CLAUDE.md` keeps its content and gains the `@AGENTS.md` line). Keep it short: only what the agent can't infer from the code. Pick the project's agent tools (docs lookup, browser, Figma, DB, GitHub, LSP) with `references/dev-tools.md`: only what the project needs, least privilege, never connected to production.
8. **Confirm with the user**: summarize the goal, the architecture in 5 lines, the phase list, assumptions and open questions. Once approved, move to the `vibe-tasks` skill to split P0 into tasks (design a phase's new screens first: Claude Design, Figma or a screenshot mockup). Later phases are split when the previous one closes.
