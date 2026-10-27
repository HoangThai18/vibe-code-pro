---
name: vibe-check
description: "Only when the user explicitly runs /vibe-check ($vibe-check in Codex); questions about whether work is done go to vibe-review. Reviews a task or phase; PASS merges it."
argument-hint: "[task id, 'phase P1', branch or PR; empty for the current task branch]"
disable-model-invocation: true
---

Scope (may be empty): $ARGUMENTS
(If that line shows a placeholder instead of text, use what the user typed after the command.)

Empty scope: the current branch (`task/<id>` → that task). Reply in the user's language; write commands in the form this agent uses (`/vibe-next` in Claude Code, `$vibe-next` in Codex).

1. Run the `vibe-review` skill on the scope: a task → its card and `git diff phase/P1...task/<id>`; `phase P1` → `git diff main...phase/P1` and the phase's exit criteria; a branch or PR without a card → review in chat only, merge nothing.
2. First line: **PASS**, **PASS + follow-up** or **BLOCK**. Then the evidence: commands run and their results (tests, typecheck, lint), each acceptance criterion with its evidence, checklist sections covered.
3. Close as the `vibe-review` skill's step 6 says:
   - PASS (task): merge `task/<id>` into the phase branch with `--no-ff`, set `done`, commit. Merges go through PRs: print the exact commands and leave the card at `review`. A card already reviewed PASS: PR merged → just set `done`; not yet → ask the user to merge it.
   - PASS (phase): merge or PR `phase/P1 → main`, check the staging deploy, set the phase `done` in `PHASES.md`. Next: `/vibe-next` splits the next phase.
   - BLOCK: each problem with file, line and fix; card back to `doing`. Suggest `/vibe-next <id>` to fix them.
