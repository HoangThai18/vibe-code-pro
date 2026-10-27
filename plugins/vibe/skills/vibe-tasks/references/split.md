# Job A: split a phase into task cards

Inputs: the phase in `docs/plan/PHASES.md` (the first phase without cards, or the one the user names), `DOMAIN.md`, `ARCHITECTURE.md`, designs, contracts, and existing code so paths are correct. No PHASES.md: ask whether to run the `vibe-plan` skill first; for a small feature, split straight from its description. A prototype with only `docs/plan/PLAN.md` needs no cards: do its steps in order and tick them, unless the user asks for cards.

1. Start from the phase's exit criteria and work backwards to the work needed.
2. Split by lane in natural order: **DB** (migration tasks are always sequential: chain them with `deps`; `check` warns when two aren't, and the script never runs two in parallel) → **API contract** (BE lane; the card says "this task creates the contract") → **BE** and **FE** / **MOBILE** / **DESKTOP** (clients use mocks from the contract) → **INFRA / DOC** when needed. The **QA** lane is only for tests spanning several tasks, e.g. E2E for the phase's key user flows (the `vibe-build` skill, `references/e2e-playwright.md`).
3. One task = one person (or agent) doing the feature and its tests, fits one work session, reviewable in 15–30 minutes (usually under ~400 diff lines). A sub-task is one committable step. More than 7 sub-tasks or size L: split.
4. Acceptance criteria must be verifiable by command, test or screenshot, citing business rule `BR-xx` where relevant. "Clean code" or "works fine" can't be checked.
5. Declare `touches` fully: every file/folder created or edited, including mocks, fixtures, test helpers, and hotspot files (router index, root schema, `package.json`, lockfile, i18n, `migrations/`). Every file named in the goal and acceptance criteria must be in `touches`. Next.js-style `[id]` names are literal, not globs.
6. A task that creates a table or endpoint touching multiple customers' data puts the tenant isolation test in **its own** acceptance criteria (whoever writes the code writes the test, per step 3); never split it into a later QA task.
7. Fill the card's "Security" section for tasks touching auth, tenant data, personal data, uploads or outbound calls (the `vibe-backend` skill, `references/app-security.md` section 1).
8. Write "Out of scope" so work doesn't spread into other tasks.
9. A phase with new screens: design them first (Claude Design, Figma or a screenshot mockup) and link the design in the UI cards.

One file per task: `docs/tasks/<id>-<slug>.md` from `templates/task.md`; ids look like `P1-T03`. Write task cards in the user's language unless the repo already uses another; keep frontmatter keys and values as below. Real sample: `examples/mini-crm/` (read `P1-T03-customers-api.md`). The script reads the frontmatter:

```yaml
---
id: P1-T03
title: Customer CRUD API
phase: P1             # must match the id's prefix
lane: BE              # DB | BE | FE | MOBILE | DESKTOP | INFRA | QA | DOC
status: todo          # todo | doing | review | done | blocked
deps: [P1-T01, P1-T02]
touches: [apps/api/src/modules/customers/**, apps/api/src/routes.ts]
size: M               # S | M | L
---
```

Quote a title containing `#` (YAML treats `#` after a space as a comment). Notes in `docs/tasks/` that aren't cards: name them `README.md` or start the name with `_`. Run `check` until it has no errors, then show the user an `ID | Lane | Task | Deps | Size` table to approve. Once approved, set the phase to `doing` in `PHASES.md` and commit the cards.
