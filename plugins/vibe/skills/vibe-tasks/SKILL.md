---
name: vibe-tasks
description: "Manage project work as task cards in docs/tasks: split phases into tasks and sub-tasks with deps, touches and acceptance criteria; a script validates and orders them and finds what can run in parallel; track progress, pick the next task, write an end-of-session handoff. Use when breaking down work, checking progress or what's next, wrapping up a session, or right after PHASES.md is approved. Without docs/plan or docs/tasks, use only if the user wants this workflow. Also use for Vietnamese requests like 'chia task', 'tới đâu rồi', 'làm gì tiếp', 'xem tiến độ', 'tổng kết phiên', 'mai làm tiếp'."
---

# Tasks: split work, track progress, resume across sessions

Bundled script `scripts/tasks.py` (`<tasks-skill>` = this skill's folder; run from the project root):

```bash
python3 <tasks-skill>/scripts/tasks.py check  --dir docs/tasks   # errors: duplicate ids, bad deps, dependency cycles, missing touches
python3 <tasks-skill>/scripts/tasks.py status --dir docs/tasks   # progress by phase
python3 <tasks-skill>/scripts/tasks.py next   --dir docs/tasks   # tasks ready now, preferring those that unblock the most others
python3 <tasks-skill>/scripts/tasks.py waves  --dir docs/tasks --phase P1   # order of work in dependency waves
# Add --max-parallel N to next/waves only once you've decided to run in parallel (`vibe-build` skill): batches never share a file
```

(Windows: `python` or `py -3`. If Python can't run, read the task cards' frontmatter and summarize by the same rules.)

Everything important (tasks, status, decisions) lives in repo files, not in one chat's memory, so any session can continue.

**Size it right.** Task cards are for multi-step work spanning sessions. A small fix or a feature done in one session needs no card: just do it (`vibe-build` skill), or list a few steps in chat. If the repo doesn't use `docs/tasks` yet, ask the user before setting up this system.

## Job A: split a phase into tasks

Inputs: the phase in `docs/plan/PHASES.md` (missing: ask whether to run the `vibe-plan` skill first; for a small feature, split straight from the description), `DOMAIN.md`, `ARCHITECTURE.md`, designs, contracts, and existing code so paths are correct.

1. Start from the phase's exit criteria and work backwards to the work needed.
2. Split by lane in natural order: **DB** (migration tasks are always sequential with each other) → **API contract** (BE lane; the card says "this task creates the contract") → **BE** and **FE** / **MOBILE** / **DESKTOP** (clients use mocks from the contract) → **INFRA / DOC** when needed. The **QA** lane is only for tests spanning several tasks, e.g. E2E for the phase's key user flows (the `vibe-build` skill, `references/e2e-playwright.md`).
3. One task = one person (or agent) doing the feature and its tests, fits one work session, reviewable in 15–30 minutes (usually under ~400 diff lines). A sub-task is one committable step. More than 7 sub-tasks or size L: split.
4. Acceptance criteria must be verifiable by command, test or screenshot, citing business rule `BR-xx` where relevant. "Clean code" or "works fine" can't be checked.
5. Declare `touches` fully: every file/folder created or edited, including mocks, fixtures, test helpers, and hotspot files (router index, root schema, `package.json`, lockfile, i18n, `migrations/`). Every file named in the goal and acceptance criteria must be in `touches`.
6. A task that creates a table or endpoint touching multiple customers' data puts the tenant isolation test in **its own** acceptance criteria (whoever writes the code writes the test, per step 3); never split it into a later QA task.
7. Write "Out of scope" so work doesn't spread into other tasks.

One file per task: `docs/tasks/<id>-<slug>.md` from `templates/task.md`; ids look like `P1-T03`. Write task cards in the user's language unless the repo already uses another; keep frontmatter keys and values as below. Real sample: `examples/mini-crm/` (read `P1-T03-customers-api.md`). The script reads the frontmatter:

```yaml
---
id: P1-T03
title: Customer CRUD API
phase: P1
lane: BE              # DB | BE | FE | MOBILE | DESKTOP | INFRA | QA | DOC
status: todo          # todo | doing | review | done | blocked
deps: [P1-T01, P1-T02]
touches: [apps/api/src/modules/customers/**, apps/api/src/routes.ts]
size: M               # S | M | L
---
```

Quote a title containing `#` (YAML treats `#` after a space as a comment). Run `check` until clean, then show the user an `ID | Lane | Task | Deps | Size` table to approve.

## Job B: progress and next step

1. Read `docs/HANDOFF.md` first if present (the last session's note), but cross-check it with `git log` and the task cards; it may be stale.
2. Run `status` and `next`; check `git status`, the current branch, open worktrees.
3. Report in ~10 lines max: current phase, x/y tasks, what's in progress, what's blocked and who must decide.
4. Propose **one** next step:
   - A `doing` task exists: finish it first (one agent works tasks one at a time). No sign of work (commit, branch, worktree, running agent): ask the user whether anyone is still on it.
   - No unfinished task: do the first task `next` suggests with the `vibe-build` skill. Suggest parallel work only with 2+ large independent tasks and a user who wants speed (conditions in the `vibe-build` skill).
   - A task in `review` (code done, not merged): `vibe-review` skill first, since it still holds its files and blocks later tasks.
   - Phase out of tasks: `review` the whole phase, then the `vibe-ship` skill to deploy to staging or production.
   - A `blocked` task: say exactly what the user must decide.
5. If status changed, update `docs/STATUS.md` (from `templates/STATUS.md`, create it if missing) and commit. If the user only asks "where are we", answering in chat is enough.

## Job C: end-of-session handoff

When the user says "wrap up", "stop here", "continue tomorrow", or the context is long: write `docs/HANDOFF.md` from `templates/HANDOFF.md` with the exact state (which sub-task, which file, what error, which command fails). Once the next session finishes its items, move the file to `docs/handoffs/YYYY-MM-DD.md` so old notes aren't reread.

## Conventions

- Status: `todo` → `doing` (in progress) → `review` (code done, **not merged**, still holds its files) → `done` (merged into the phase branch); `blocked` with the reason in Notes.
- Branches: one integration branch per phase (`phase/P1`); one branch per task (`task/P1-T03`, or the branch your agent names when it runs in a worktree, as Claude Code does); at phase end open a PR `phase/P1 → main`.
- Commits: `<TASK-ID>: <what>`. Only the main session writes task cards and STATUS.md, so status files never conflict.
