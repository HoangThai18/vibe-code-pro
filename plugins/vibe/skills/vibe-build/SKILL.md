---
name: vibe-build
description: "Builds a task card, or a feature in an existing project, as tested code: one agent writes the feature and its tests (unit, real-DB integration, Playwright E2E with roles, workspace switch, screenshots, a11y), verifies, hands over to review. Also for writing tests, flaky tests, and deciding on subagents or parallel tasks (default: no). Also use for Vietnamese requests like 'làm task P1-T03', 'code tiếp', 'viết test', 'test giao diện', 'test chập chờn', 'chạy song song'."
---

# Build: from task card to verified code

Task script: `scripts/tasks.py` in the `vibe-tasks` skill (skills sit side by side: `python3 <this skill's folder>/../vibe-tasks/scripts/tasks.py next --dir docs/tasks`; Windows: `py -3`).

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

The main session does tasks one at a time: read the task card, code, write tests, run, fix, hand over to review. Whoever writes a feature writes its tests too, because they hold the context: why this approach, where it can break. Splitting "one agent codes, another tests" loses context at every handoff. Use subagents only when it clearly pays off (last section).

**Scale to fit.** If the repo has no `docs/tasks`, or the job is small (a few files, one session): skip task cards, phase branches and status updates; self-review against the `vibe-review` skill's checklist and commit. Keep what makes quality: read similar code before writing, test the change, run verify, change only what was asked.

## Workflow for one task

1. **Branch**:
   - No git repo: ask the user, then `git init -b main`, check `.gitignore` covers `.env*` and dependency folders, commit the existing files.
   - No phase branch: `git switch -c phase/P1 main` (or the repo's default branch).
   - `task/<ID>` exists (resumed or after a BLOCK): `git switch task/<ID>`; read `docs/reviews/<ID>.md` if the card links it and fix its findings first. Otherwise `git switch -c task/<ID> phase/P1`.
   - Set `status: doing`, commit `<ID>: start` (the checkpoint to return to).
2. **Read before coding**: the task card, `AGENTS.md`, the relevant part of `docs/domain/DOMAIN.md` (rules `BR-xx`), the contract, the design, and 1–2 places in the codebase that already do something similar, so you follow their structure and conventions (unfamiliar codebase: use the `vibe-architecture` skill). Use the `vibe-backend`, `vibe-frontend`, `vibe-mobile`, `vibe-desktop` or `vibe-ai` skill when the task touches that area; each skill loads only the docs needed.
3. **Check docs for any API you are unsure of**: check the installed version and read the docs for that version (the `vibe-plan` skill, `references/tech-research.md`). Never guess function signatures or package names.
4. **Code and tests together**, following codebase conventions (reuse existing helpers, error classes, components; put code in the right layer and module), sub-task by sub-task, committing `<ID>: <what>` after each meaningful step. Tests cover every acceptance criterion and error path; pick the level per `references/testing.md`. Three rules for every line you write (details: the `vibe-architecture` skill, `references/design-principles.md` section 2):
   - **Repeated logic**: about to write the same logic a third time (counting copies already in the code)? Extract one function, point every copy at it in this change, test it. Same business rule or formula: one place from the second copy.
   - **Comments say why, never what**: no comments that restate the code, no banners, no "added/updated/fixed" notes, no commented-out code. Match the file's comment density.
   - **Libraries before hand-written code**: CSV/Excel, dates and time zones, validation, retries, sanitizing, crypto, parsing phones or URLs: use the project's dependency or the platform (`Intl`, `crypto`, `URL`) first, then a maintained library. Never hand-roll these to avoid a dependency.
5. **Change only files in `touches`**. If something outside scope needs changing, stop and tell the user (or create a new task); don't spread. One exception: copies of logic you extract under the rule above may be pointed at the new function, with tests; name those files in the report.
6. **Verify**: run the task card's verify command plus typecheck, lint and all related tests. UI task: take screenshots to check (the `vibe-frontend` skill). Task touching a main flow that has E2E: run that flow's E2E too. Never make a check pass by weakening it: deleting, skipping or loosening tests or assertions, changing expected values or snapshots to match new output, excluding files from test or lint. An expected value that really changed: say why in the commit.
7. **Hand over to review**: tick the sub-tasks, set `status: review`, commit, keep `task/<ID>` (don't merge). Report what changed and the checks run, then suggest the review (`/vibe-check <ID>`, written the way this agent runs commands). The `vibe-review` skill reviews (independent verifier for auth, tenant data, money or migrations) and, on PASS, merges with `--no-ff` and sets `done`.

## Safety net

- Start each task from a clean tree (`git status`): commit or set aside leftover changes first, asking whose they are, so every change of this task can be undone.
- Undo: an uncommitted edit → `git restore <file>`; a committed step → `git revert <sha>` (keeps history).
- `git reset --hard`, `git clean`, `git push --force`, and deleting a branch with unmerged work: only when the user explicitly agrees to that exact command.

## When to use subagents

Only for a concrete reason: each subagent costs tokens like a separate session, and each handoff loses context. They need an agent that supports subagents (Claude Code, Cursor, Copilot) or the user running several sessions.

- **Parallel**: 2+ ready tasks that are **large** (each worth its own session) and **independent** (no shared files, no shared DB with migrations, no shared ports), and the user wants to save time. How: `references/parallel.md`.
- **Context too large**: a job that reads many files but only needs the conclusion (e.g. surveying a whole legacy codebase): hand it off to keep the main context small.
- **Independent verification**: the `vibe-review` skill's verifier deliberately lacks the author's context, so it isn't anchored to their thinking.

Everything else: do it directly in the main session.
