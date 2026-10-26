---
name: vibe-help
description: "Show the vibe command table and suggest the next command from the project's state."
disable-model-invocation: true
---

Reply in the user's language, briefly:

1. Print this table (translate the second column to the user's language):

| Command | What it does |
|---|---|
| `/vibe-start <idea>` | Start: new project → domain analysis, plan, task cards; existing code → survey the codebase, write AGENTS.md, task cards |
| `/vibe-status` | Where are we: progress, task in progress, blocked tasks |
| `/vibe-next [P1-T03]` | Do the next task (or that task): code with tests |
| `/vibe-check` | Check changes before merge: tests, independent review, PASS or BLOCK |
| `/vibe-fix <bug>` | Fix a bug or production incident |
| `/vibe-ship <task>` | Deploy, rollback, backup, monitoring |
| `/vibe-help` | This table |

Codex uses `$vibe-start` instead of `/vibe-start`. Domain skills load on their own when needed: vibe-plan, vibe-tasks, vibe-architecture, vibe-backend, vibe-frontend, vibe-mobile, vibe-desktop, vibe-ai, vibe-build, vibe-review.

2. Add one "Suggestion:" line:
   - `docs/tasks/` exists: run `python3 <vibe-tasks skill folder>/scripts/tasks.py next --dir docs/tasks`. A task in progress or ready → `/vibe-next <that id>`; nothing left → `/vibe-check` or `/vibe-ship`.
   - No `docs/tasks/`: suggest `/vibe-start` with a one-line product description.

3. End with one line: no need to remember commands, just say it ("continue", "500 error when creating a customer", "deploy to staging").

Do not edit any file.
