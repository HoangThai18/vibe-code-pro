---
name: vibe-next
description: "Only when the user explicitly runs /vibe-next ($vibe-next in Codex); progress questions go to vibe-tasks. Does the next task card with tests, then stops at review."
argument-hint: "[task id, e.g. P1-T03; empty for the recommended task]"
disable-model-invocation: true
---

Requested task (may be empty): $ARGUMENTS
(If that line shows a placeholder instead of text, use what the user typed after the command.)

Task script: `python3 <this skill's folder>/../vibe-tasks/scripts/tasks.py` (skills sit side by side; Windows: `py -3`; no Python: read the cards' frontmatter and apply the same rules). Reply in the user's language; write commands in the form this agent uses (`/vibe-check` in Claude Code, `$vibe-check` in Codex).

1. **Where we left off**: read `docs/HANDOFF.md` if present and run `git status` (uncommitted work, current branch). Its "Do first" items come first, after checking them against `git log` and the cards (it may be stale).
2. **Pick the work**:
   - No `docs/tasks/`: `docs/plan/PLAN.md` (prototype) → do its next unchecked step with the `vibe-build` skill and tick it; `docs/plan/PHASES.md` → split its first phase (the `vibe-tasks` skill, `references/split.md`), show the task table for approval, stop; neither → suggest `/vibe-start`, stop.
   - Run `tasks.py next --dir docs/tasks`. Card errors at the top: fix the cards first.
   - Id given: use it; unfinished deps → say which and ask whether to do those first.
   - A task in `review` → start nothing new: suggest `/vibe-check <id>`, stop.
   - `blocked` → state the decision the user must make (from the card's Notes), stop.
   - `doing` → continue it. Its card links a BLOCK review (`docs/reviews/<id>.md`): switch to the existing `task/<id>` branch and fix every finding first.
   - Otherwise the task under "Start now".
   - Phase finished → suggest `/vibe-check phase P1` (phase review, merge `phase/P1 → main`, staging), stop. Already closed (`done` in `PHASES.md`, or `phase/P1` merged into `main`) → split the next phase (the `vibe-tasks` skill, `references/split.md`), show the table for approval, stop.
3. **Do it** with the `vibe-build` skill: branch, read the card, `AGENTS.md` and similar code; code with tests; run tests, typecheck, lint; change only files in `touches`.
4. **Stop at review**: `status: review`, commit, keep the branch (no merge). Report: what changed, checks run and their results, what's left. Suggest `/vibe-check <id>`. Handoff items all done: move `docs/HANDOFF.md` to `docs/handoffs/YYYY-MM-DD.md`.

One task per run.
