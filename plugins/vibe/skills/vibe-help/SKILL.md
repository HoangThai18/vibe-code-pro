---
name: vibe-help
description: "Only when the user explicitly runs /vibe-help ($vibe-help in Codex). Lists the vibe commands and suggests the next one."
disable-model-invocation: true
---

Reply in the user's language, briefly. Edit no file.

1. Print this table, translating the second column and writing commands in the form this agent uses (`/vibe-start` in Claude Code, `$vibe-start` in Codex):

| Command | What it does |
|---|---|
| `/vibe-start <idea>` | Start: new project → domain analysis, plan, P0 task cards; existing code → survey it, propose AGENTS.md, task cards |
| `/vibe-status` | Where are we: progress, task in progress, blocked tasks, next step |
| `/vibe-next [P1-T03]` | Do the next task (or that one) with tests; stops at review |
| `/vibe-check [P1-T03 or phase P1]` | Review with evidence; PASS merges and marks done, BLOCK lists what to fix |
| `/vibe-fix <bug>` | Fix a bug or production incident |
| `/vibe-ship <task>` | Deploy, rollback, backup, monitoring |
| `/vibe-help` | This table |

The loop: `/vibe-start` → `/vibe-next` → `/vibe-check` → `/vibe-next`... When a phase is finished, `/vibe-check phase P1` closes it and the next `/vibe-next` splits the next phase. Domain skills load on their own: vibe-plan, vibe-tasks, vibe-architecture, vibe-backend, vibe-frontend, vibe-mobile, vibe-desktop, vibe-ai, vibe-build, vibe-review.

2. Add one "Suggestion:" line from the project's state. With `docs/tasks/`, run `python3 <this skill's folder>/../vibe-tasks/scripts/tasks.py next --dir docs/tasks` (skills sit side by side; Windows: `py -3`; no Python: read the cards' frontmatter):
   - card errors → fix the cards (`tasks.py check`);
   - a task in `review` → `/vibe-check <id>`;
   - a task in `doing`, or one ready → `/vibe-next <id>`;
   - `blocked` → the decision the user must make;
   - phase finished → `/vibe-check phase P1`, then `/vibe-next` splits the next phase.

   No `docs/tasks/`: `docs/plan/PLAN.md` or `docs/plan/PHASES.md` exists → `/vibe-next`; nothing → `/vibe-start` with a one-line product description.

3. End with one line: no need to remember commands, just say it ("continue", "500 error when creating a customer", "deploy to staging").
