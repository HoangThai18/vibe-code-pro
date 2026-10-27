---
name: vibe-review
description: "Evidence-based review before merging a task or closing a phase: checks, acceptance criteria matched to evidence, an independent read-only verifier, a PASS / PASS + follow-up / BLOCK verdict; PASS merges a task card and marks it done. Use when asked if a task is done or ready to merge, to review a branch or PR, to close a phase, or after a risky task (auth, tenant data, money, migrations). Also use for Vietnamese requests like 'task này xong chưa', 'review task P1-T03', 'chốt phase', 'sẵn sàng merge chưa'."
---

# Review: acceptance with evidence

Checklist: `references/checklist.md`. Verifier instructions: `references/verifier.md`. Report: `templates/REVIEW.md`.

"Done" means there is evidence, not that the author (you included) says so.

## Right-size it

- **Loose code snippet, branch or PR with no task card**: review against the checklist, answer in chat. Skip steps 3, 5 and 6, write no file, merge nothing.
- **Low-risk task**: steps 1, 2, a self-review against the checklist instead of step 3, then 4, 5 (short report) and 6.
- **Risky task (auth, tenant data, money, migrations) and phase close**: all 6 steps.

## Scope and where to run

- **Task**: the code is on the task's branch (`task/<ID>`, or the branch in the subagent's worktree, from its report or `git worktree list`; don't guess the name). Diff: `git diff phase/P1...<branch>`. Run checks **where that code is**: with that branch checked out, or pointed at the worktree (`pnpm --dir <worktree> test`). Checks run on the phase branch pass without ever touching the task's code.
- **Phase**: `git diff main...phase/P1` + the exit criteria in `PHASES.md` + the phase's task cards.

## Step 1: Automated checks

Run the commands in `AGENTS.md`: typecheck, lint, test, build; with a new migration, run it on an empty DB and on a DB with sample data. Record commands and results. Any failure: the verdict is BLOCK; stop and report the specific error.

## Step 2: Match acceptance criteria

Each criterion (or phase exit criterion) needs evidence: test name, command output, screenshot, query result. No evidence counts as not met, even if the code looks right.

## Step 3: Independent verifier

Inputs for the verifier: the diff command, the path where the code is (worktree or branch), the task card or `PHASES.md`, and the **absolute** path of `references/checklist.md` (this skill's folder + `references/checklist.md`; a relative path would resolve against the project). If the project's tests need a DB or port, also give a dedicated `DATABASE_URL` and port not used by any running agent (tests resetting each other's DB fail or pass falsely).

- **`vibe-verifier` agent installed** (Claude Code plugin: `vibe:vibe-verifier`): spawn it; it is read-only and never edits.
- **No such agent** (`npx skills add`, manual install, other agents): spawn any read-only subagent with `references/verifier.md` (absolute path) as its instructions, or, without subagents, have the user open a fresh session with that file and the inputs above.

Give code and requirements, **never your conclusions or reasoning**: the verifier's separate context exists so it isn't anchored to the author's thinking.

## Step 4: Classify and give the verdict

Merge findings and drop duplicates; for a serious finding, open the code and confirm it yourself before trusting it.

| Level | Includes |
|---|---|
| 🔴 Blocking | Cross-tenant data leak, auth/authz hole, data loss or corruption, dangerous migration, unmet acceptance criteria, failing or weakened tests |
| 🟡 Fix before merge | Wrong error handling, missing tests for important branches, N+1, new query missing an index, UI clearly off-design |
| 🔵 Suggestion | Naming, small refactors, docs |

- **PASS**: no 🔴 or 🟡.
- **PASS + follow-up**: only minor 🟡 and the user agrees to defer them; create a task card for each.
- **BLOCK**: any 🔴, or a 🟡 the user wants fixed now.

## Step 5: Write the report

`docs/reviews/<ID>.md` (phase: `docs/reviews/P1.md`) from `templates/REVIEW.md`, in the project docs' language.

## Step 6: Close (task cards and phases)

Commit each step as `<ID>: ...`.

- **Task PASS / PASS + follow-up**: commit the report on the task branch; `git switch phase/P1`, `git merge --no-ff task/<ID>`, rerun the tests; set the card to `done` (tick criteria, link the report), commit, `git branch -d task/<ID>`. If merges go through PRs (`AGENTS.md` says so, or the branch is protected): print the exact commands instead (`git push -u origin task/<ID>`, `gh pr create --base phase/P1 --head task/<ID> --fill`) and leave the card at `review`; set `done` when a later run sees the PR merged.
- **Phase PASS**: the same for `phase/P1 → main` (a PR by default); staging deploys from `main` (check the deploy with the `vibe-ship` skill); set the phase `done` in `PHASES.md`. Next: split the next phase (the `vibe-tasks` skill).
- **BLOCK**: set the card back to `doing` with the report link in Notes, commit on the task branch. Fix on that branch, then review again.

Update `docs/STATUS.md` if the project keeps one. Never downgrade a finding, or weaken a test, just to let it pass.
