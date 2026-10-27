---
name: vibe-tasks
description: "Task cards in docs/tasks: split a phase into tasks (deps, touches, acceptance criteria; a script checks and orders them), track progress, pick the next step, write a session handoff. Use when breaking down work, asking where things stand or what's next, continuing or resuming where you left off, wrapping up a session, or after PHASES.md is approved; without docs/plan or docs/tasks, only if the user wants this workflow. Also use for Vietnamese requests like 'chia task', 'tới đâu rồi', 'làm gì tiếp', 'tiếp tục', 'làm tiếp đi', 'hôm qua làm tới đâu', 'tổng kết phiên'."
---

# Tasks: split work, track progress, resume across sessions

Bundled script `scripts/tasks.py` (`<tasks-skill>` = this skill's folder; run from the project root):

```bash
python3 <tasks-skill>/scripts/tasks.py check  --dir docs/tasks   # errors: files that aren't cards, duplicate ids, bad deps, cycles, phase ≠ id; warnings: missing touches, unchained DB tasks
python3 <tasks-skill>/scripts/tasks.py status --dir docs/tasks   # progress by phase
python3 <tasks-skill>/scripts/tasks.py next   --dir docs/tasks   # what now: review first, then the running task, then a ready task of the lowest unfinished phase
python3 <tasks-skill>/scripts/tasks.py waves  --dir docs/tasks --phase P1   # order of work in dependency waves
# Add --max-parallel N to next/waves only once you've decided to run in parallel (`vibe-build` skill): batches never share a file or two DB schema changes
```

`next`, `status` and `waves` print card errors first and exit 1 on errors, no cards or an unknown phase: fix the cards first. (Windows: `py -3` or `python`. If Python can't run, read the task cards' frontmatter and apply the same rules.)

Everything important (tasks, status, decisions) lives in repo files, not in one chat's memory, so any session can continue.

**Size it right.** Task cards are for multi-step work spanning sessions. A small fix or a feature done in one session needs no card: just do it (`vibe-build` skill), or list a few steps in chat. If the repo doesn't use `docs/tasks` yet, ask the user before setting up this system.

## Job A: split a phase into tasks

Right after PHASES.md is approved, after a phase closes, or for a feature big enough for cards: follow `references/split.md`. It ends with a task table for the user to approve.

## Job B: progress and next step

1. Read `docs/HANDOFF.md` first if present (the last session's note), but cross-check it with `git log` and the task cards; it may be stale.
2. Run `status` and `next`; check `git status` (uncommitted work), the current branch, `git worktree list`.
3. Report in ~10 lines max: current phase, x/y tasks, what's in progress, what's blocked and who must decide.
4. Propose **one** next step, in the order `next` uses:
   - Card errors: fix the cards first (`check`).
   - A task in `review` (code done, not merged): review and merge it first (the `vibe-review` skill), since it still holds its files and blocks later tasks.
   - A `doing` task: finish it first (one agent works tasks one at a time); if its review said BLOCK, fix the findings on its branch. No sign of work (commit, branch, worktree, running agent): ask the user whether anyone is still on it.
   - A `blocked` task: say exactly what the user must decide.
   - Otherwise the task `next` suggests, done with the `vibe-build` skill. Suggest parallel work only with 2+ large independent tasks and a user who wants speed (conditions in the `vibe-build` skill).
   - Phase out of tasks: close it: review the whole phase (the `vibe-review` skill), merge `phase/P1 → main` (PR), deploy to staging (the `vibe-ship` skill). Then (or right away if `PHASES.md` already marks it `done`) Job A for the next phase, and show its task table for approval.
   - No `docs/tasks/` but `docs/plan/PLAN.md` (prototype): its next unchecked step.
5. If status changed, update `docs/STATUS.md` (from `templates/STATUS.md`, create it if missing) and commit. If the user only asks "where are we", answer in chat and start nothing.

## Job C: end-of-session handoff

When the user says "wrap up", "stop here", "continue tomorrow", or the context is long: commit or describe uncommitted work, then write `docs/HANDOFF.md` from `templates/HANDOFF.md` with the exact state (which sub-task, which file, what error, which command fails). Once the next session finishes its "Do first" items, move the file to `docs/handoffs/YYYY-MM-DD.md` so old notes aren't reread.

## Conventions

| Status | Meaning | Set by |
|---|---|---|
| `todo` | not started | Job A |
| `doing` | in progress on branch `task/<ID>` | the `vibe-build` skill (step 1); the `vibe-review` skill after a BLOCK |
| `review` | code done and verified, branch kept, **not merged** (still holds its files) | the `vibe-build` skill (last step) |
| `done` | merged into the phase branch (`--no-ff`) | the `vibe-review` skill on PASS |
| `blocked` | waits for a decision; the reason in Notes | anyone |

- Branches: one integration branch per phase (`phase/P1`, from `main`); one branch per task (`task/P1-T03` from the phase branch, or the branch your agent names when it runs in a worktree, as Claude Code does); at phase end, a PR `phase/P1 → main`.
- Phases in `PHASES.md`: `todo` → `doing` (cards approved) → `done` (phase review PASS, merged into `main`).
- Commits: `<TASK-ID>: <what>`. Only the main session writes task cards and STATUS.md, so status files never conflict.
