---
name: vibe-next
description: "Do the project's next task: pick the ready task (or the one given), code it with tests following the codebase's conventions, run checks, update the task card."
argument-hint: "[task id, e.g. P1-T03; empty for the recommended task]"
disable-model-invocation: true
---

Requested task (may be empty): $ARGUMENTS

1. No `docs/tasks/`: say there are no task cards yet, suggest `/vibe-start`, stop.
2. Pick the task:
   - Given an id: use it. If it depends on unfinished tasks, tell the user and ask whether to do those first.
   - No id: follow `python3 <vibe-tasks skill folder>/scripts/tasks.py next --dir docs/tasks` (tasks in progress come first).
3. Do it with the `vibe-build` skill: read the task card, `AGENTS.md` and a similar place in the codebase; code with tests; run tests, typecheck, lint; change only files in the card's `touches`.
4. Done: update the task card (status, notes for the next person) and report in the user's language: what changed, which checks ran and their results, what's left. Suggest `/vibe-check` before merging.

One task per call. Run `/vibe-next` again for the next one.
