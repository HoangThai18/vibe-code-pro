---
name: vibe-start
description: "Only when the user explicitly runs /vibe-start ($vibe-start in Codex); planning requests go to vibe-plan. Starts the vibe workflow in a new or existing project."
argument-hint: "[product idea or feature; empty for an existing codebase]"
disable-model-invocation: true
---

User request (may be empty): $ARGUMENTS
(If that line shows a placeholder instead of text, use what the user typed after the command.)

Reply in the user's language; write commands in the form this agent uses (`/vibe-next` in Claude Code, `$vibe-next` in Codex). Task script: `python3 <this skill's folder>/../vibe-tasks/scripts/tasks.py` (skills sit side by side; Windows: `py -3`).

1. Look at the current folder: code (`package.json`, `pyproject.toml`, `src/`...)? `AGENTS.md` or `CLAUDE.md`, `docs/plan/`, `docs/tasks/`? A git repo?
2. Pick one path:
   - **`docs/tasks/` or `docs/plan/` exists**: the project already follows the workflow. Don't redo the plan or rewrite `AGENTS.md`. Report progress briefly (`tasks.py status --dir docs/tasks`, or the ticked steps of `docs/plan/PLAN.md`) and suggest `/vibe-next`. A new feature in the request: the `vibe-plan` skill at the size that feature needs, then the `vibe-tasks` skill to add cards.
   - **No code**: the `vibe-plan` skill for the request (1–2 rounds of questions, then DOMAIN, PRD, ARCHITECTURE, PHASES, AGENTS.md; a prototype gets one `docs/plan/PLAN.md`), then the `vibe-tasks` skill to split P0 into task cards. Empty request: ask what product to build first.
   - **Code but no workflow**: survey it with the `vibe-architecture` skill (`references/codebase-conventions.md`), then propose an `AGENTS.md` built from the `vibe-plan` skill's `templates/AGENTS.template.md` and filled with what the survey found (run, test, structure, conventions). Write it, plus a `CLAUDE.md` containing `@AGENTS.md`, only after the user approves; extend existing files, never overwrite them. With a new request, continue with the `vibe-plan` skill sized to it, then the `vibe-tasks` skill.
3. Finish with: files created or changed, decisions waiting for the user, next step (usually `/vibe-next`).

Do not write feature code here.
