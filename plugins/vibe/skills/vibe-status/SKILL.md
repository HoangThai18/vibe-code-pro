---
name: vibe-status
description: "Only when the user explicitly runs /vibe-status ($vibe-status in Codex); progress questions go to vibe-tasks. Read-only project status."
disable-model-invocation: true
---

Read-only: edit nothing; run only the task script and `git status`, `git log`, `git branch`, `git worktree list`. Task script: `python3 <this skill's folder>/../vibe-tasks/scripts/tasks.py` (skills sit side by side; Windows: `py -3`; no Python: read the cards' frontmatter and apply the same rules).

1. Read `docs/HANDOFF.md` and `docs/STATUS.md` if present; run `git status`, `git log --oneline -10`, `git branch`, `git worktree list`.
2. `docs/tasks/` exists: run `tasks.py status --dir docs/tasks` and `tasks.py next --dir docs/tasks`. Only `docs/plan/PLAN.md` (prototype): progress is its ticked steps. Only `docs/plan/PHASES.md`: no cards yet, the next step is splitting its first phase. Nothing: the project doesn't follow the vibe workflow yet; suggest `/vibe-start`.
3. Summarize in the user's language, at most 10 lines: percent done per phase; task in progress; uncommitted work; card errors; blocked tasks and the decision each needs; **one** next step and why (a task in review → `/vibe-check <id>`; phase finished → `/vibe-check phase P1`, then split the next phase; otherwise `/vibe-next <id>`). Write commands in the form this agent uses (`/vibe-next` in Claude Code, `$vibe-next` in Codex).
