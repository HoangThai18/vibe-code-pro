---
name: vibe-status
description: "Where is the project: progress per phase, task in progress, ready and blocked tasks, risks and pending decisions. Read-only."
disable-model-invocation: true
---

1. If `docs/tasks/` exists, run `python3 <vibe-tasks skill folder>/scripts/tasks.py status --dir docs/tasks` and `... next --dir docs/tasks`. Also read `docs/STATUS.md` and `docs/HANDOFF.md` if present.
2. Summarize in the user's language, at most 10 lines: percent done per phase; task in progress; **one** recommended next task and why; blocked tasks and what blocks them; risks or decisions waiting for the user. End with the suggested command, e.g. `/vibe-next P1-T03`.
3. No `docs/tasks/`: say the project doesn't follow the vibe workflow yet and suggest `/vibe-start`.

Read only: no file edits, no other commands.
