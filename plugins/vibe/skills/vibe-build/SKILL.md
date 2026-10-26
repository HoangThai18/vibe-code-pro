---
name: vibe-build
description: "Turns a task card or feature request into working, tested code: one agent writes the feature and its tests, checks version-correct docs for unfamiliar APIs, picks the test level (unit, real-DB integration, E2E), verifies, merges. Use for any task or feature, for writing or fixing any test (especially Playwright UI and user-flow tests: login, roles, workspace switch, screenshots, a11y, flaky tests), and when deciding on subagents or parallel tasks (default: no). Also use for Vietnamese requests like 'làm task P1-T03', 'code tiếp', 'viết test', 'test giao diện', 'test chập chờn', 'chạy song song'."
---

# Build: from task card to verified code

Task viewer: `scripts/tasks.py` in the `vibe-tasks` skill (`python3 <tasks-skill>/scripts/tasks.py next --dir docs/tasks`).

| Task | Read |
|---|---|
| Choosing the test level (unit, integration with a real DB, E2E), flaky tests, tests in CI | `references/testing.md` |
| Browser UI and user-flow tests with Playwright: multiple roles, visual comparison, a11y, network mocks, debugging | `references/e2e-playwright.md` |
| Mobile app tests (Jest, React Native Testing Library, Maestro on an emulator) | the `vibe-mobile` skill (`references/testing.md`) |
| Desktop app tests (Playwright for Electron, Tauri, security config tests) | the `vibe-desktop` skill (`references/testing.md`) |
| AI feature tests (fake fetch, no cost) and quality evals | the `vibe-ai` skill (`references/testing.md`) |
| Performance budgets in E2E (LCP, CLS) | the `vibe-ship` skill (`references/performance.md` section 5) |
| Considering several agents in parallel | `references/parallel.md` (and `references/agent-brief.md`) |

## Default: one agent, one loop

The main session does tasks one at a time: read the task card, code, write tests, run, fix, merge. Whoever writes a feature writes its tests too, because they hold the context: why this approach, where it can break. Splitting "one agent codes, another tests" loses context at every handoff. Use subagents only when it clearly pays off (last section).

**Scale to fit.** If the repo has no `docs/tasks`, or the job is small (a few files, one session): skip task cards, phase branches and status updates. Keep what makes quality: read similar code before writing, test the change, run verify, change only what was asked.

## Workflow for one task

1. **Pick the task**: the one `next` suggests, or the one the user names. Set `status: doing`, create branch `task/<ID>` from the phase branch (`phase/P1`).
2. **Read before coding**: the task card, `AGENTS.md`, the relevant part of `docs/domain/DOMAIN.md` (rules `BR-xx`), the contract, the design, and 1–2 places in the codebase that already do something similar, so you follow their structure and conventions (unfamiliar codebase: use the `vibe-architecture` skill). Use the `vibe-backend`, `vibe-frontend`, `vibe-mobile`, `vibe-desktop` or `vibe-ai` skill when the task touches that area; each skill loads only the docs needed.
3. **Check docs for any API you are unsure of**: check the installed version and read the docs for that version (the `vibe-plan` skill, `references/tech-research.md`). Never guess function signatures.
4. **Code and tests together**, following codebase conventions (reuse existing helpers, error classes, components; put code in the right layer and module), sub-task by sub-task, committing `<ID>: <what>` after each meaningful step. Tests cover every acceptance criterion and error path; pick the level per `references/testing.md`.
5. **Change only files in `touches`**. If something outside scope needs changing, stop and tell the user (or create a new task); don't spread.
6. **Verify**: run the task card's verify command plus typecheck, lint and all related tests. UI task: take screenshots to check (the `vibe-frontend` skill). Task touching a main flow that has E2E: run that flow's E2E too.
7. **Review**: task touches auth, tenant data, money or migrations → the `vibe-review` skill (independent verifier: if your agent supports subagents, run the `vibe-verifier` subagent; otherwise review in a fresh session with the `vibe-review` skill's checklist). Small, low-risk task → self-review with that checklist.
8. **Merge** into the phase branch (`git merge --no-ff task/<ID>`), rerun all tests, update the task card (`done`, commit, tick acceptance criteria), delete the branch, commit the status.

## When to use subagents

Only for a concrete reason: each subagent costs tokens like a separate session, and each handoff loses context. They need an agent that supports subagents (Claude Code, Cursor, Copilot) or the user running several sessions.

- **Parallel**: 2+ ready tasks that are **large** (each worth its own session) and **independent** (no shared files, no shared DB with migrations, no shared ports), and the user wants to save time. How: `references/parallel.md`.
- **Context too large**: a job that reads many files but only needs the conclusion (e.g. surveying a whole legacy codebase): hand it off to keep the main context small.
- **Independent verification**: the `vibe-review` skill's verifier deliberately lacks the author's context, so it isn't anchored to their thinking.

Everything else: do it directly in the main session.
