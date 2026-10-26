---
name: vibe-check
description: "Check changes before merge: lint, typecheck, tests, an independent review against the checklist; verdict PASS or BLOCK with evidence."
argument-hint: "[branch, PR number or task id; empty for the current changes]"
disable-model-invocation: true
---

Scope (may be empty): $ARGUMENTS

Use the `vibe-review` skill on that scope; empty means the current branch's changes against its base (`git diff` against the phase branch or `main`). Report in the user's language:

- **PASS** or **BLOCK** on the first line.
- Evidence: commands run and their results (tests, typecheck, lint), checklist sections covered.
- BLOCK: each problem with file, line and how to fix; suggest `/vibe-next <task id>` to fix it.

This command does not change code.
