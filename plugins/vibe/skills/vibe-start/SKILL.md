---
name: vibe-start
description: "Start with vibe: new project → clarify requirements, analyze the domain, plan, create task cards; existing code → survey the codebase, write AGENTS.md, then task cards for the next work."
argument-hint: "[product idea or feature; empty for an existing codebase]"
disable-model-invocation: true
---

User request (may be empty): $ARGUMENTS

Reply in the user's language.

1. Look at the current folder: code present (`package.json`, `pyproject.toml`, `src/`...)? `AGENTS.md` or `CLAUDE.md`, `docs/plan/`, `docs/tasks/`?
2. Pick one path:
   - **`docs/tasks/` exists**: the project already follows the workflow. Don't redo the plan. Report progress briefly (`python3 <vibe-tasks skill folder>/scripts/tasks.py status --dir docs/tasks`) and suggest `/vibe-next`. If the request is a new feature, use the `vibe-plan` skill at the size that feature needs, then `vibe-tasks` to add task cards.
   - **No code**: use the `vibe-plan` skill for the request (1–2 rounds of questions, then DOMAIN, PRD, ARCHITECTURE, PHASES, AGENTS.md), then `vibe-tasks` for phase 1 task cards. Empty request: ask what product to build first.
   - **Code but no workflow**: use the `vibe-architecture` skill to survey the codebase's conventions and write `AGENTS.md` (run, test, structure, conventions; plus a `CLAUDE.md` containing `@AGENTS.md` for Claude Code). With a new request, continue with `vibe-plan` sized to it, then `vibe-tasks`.
3. Finish with: files created or changed, decisions waiting for the user, next step (usually `/vibe-next`).

Do not write feature code here.
