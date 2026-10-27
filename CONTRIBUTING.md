# Contributing to vibe

Thanks for making the skills better. People follow these skills to build real software, so the bar is **correct first, short second**.

## Principles

1. **Examples must run.** Every code, SQL, YAML or shell snippet you add is run on a specific version (state it in the PR). SQL runs on real PostgreSQL as the role the doc talks about (the app role is not a superuser). GitHub Actions pass `actionlint`. TypeScript passes `tsc --strict`.
2. **Tests must catch bugs.** Run example tests (tenant isolation, Playwright...) against correct code and against deliberately broken code; they must fail on the broken one.
3. **One main agent.** Don't add a subagent for work the main session can do. Subagents are for independent verification, large independent work in parallel, or reading a lot when only the conclusion matters. Skills must still work in agents without subagents.
4. **Load on demand, spend few tokens.** `SKILL.md` holds when to use it, a table pointing to reference files, a few always-on rules and a "size it right" note. Details go in `references/`; files over 100 lines get a table of contents. Write plain, direct English.
5. **Agent Skills standard.** Domain skills use only `name` and `description` in frontmatter (`description` under 1024 characters, no `<` or `>`), end the description with a few Vietnamese trigger phrases, never use agent-specific variables such as `${CLAUDE_SKILL_DIR}`, and refer to other skills by name (`the vibe-backend skill`). Agent-specific features (subagents, Claude Code settings) are optional notes.
6. **Don't guess APIs.** Libraries change fast: check the docs for the installed version before writing, and say when a detail depends on the version.

## Before opening a PR

```bash
pip install skills-ref==0.1.1
# Domain skills: strict
for d in plugins/vibe/skills/*/; do
  case "$(basename "$d")" in vibe-help|vibe-start|vibe-status|vibe-next|vibe-check) continue ;; esac
  agentskills validate "$d" || echo "FAILED: $d"
done
# Commands: a copy without the two Claude Code-only fields (disable-model-invocation, argument-hint) must pass
tmp=$(mktemp -d)
for n in vibe-help vibe-start vibe-status vibe-next vibe-check; do
  cp -R "plugins/vibe/skills/$n" "$tmp/$n"
  sed -i.bak '/^disable-model-invocation:/d; /^argument-hint:/d' "$tmp/$n/SKILL.md" && rm "$tmp/$n/SKILL.md.bak"
  agentskills validate "$tmp/$n" || echo "FAILED: $n"
done
claude plugin validate ./plugins/vibe
python3 -m unittest discover -s verify/tasks        # tasks.py unit tests (CI: Python 3.8 and 3.12)
python3 plugins/vibe/skills/vibe-tasks/scripts/tasks.py check --dir plugins/vibe/skills/vibe-tasks/examples/mini-crm
```

Any `FAILED:` line is a real error. CI (`.github/workflows/skills.yml`) also checks that every `references/`, `templates/` and `scripts/` path a skill mentions exists (in that skill or in a skill named on the same line), that `vibe-review/references/verifier.md` matches `agents/vibe-verifier.md`, and that each command has `agents/openai.yaml` with `allow_implicit_invocation: false` (Codex).

- Changed how a skill behaves: add or update a case in `plugins/vibe/evals/`, run `claude plugin eval` with and without your change, and put the results in the PR.
- Changed `tasks.py`: add a test in `verify/tasks/test_tasks.py`. Changed `tasks.py` output or the mini-crm example: run `python3 assets/make_graphics.py` so the README terminal image matches real output.
- Changed the verifier's instructions: edit `agents/vibe-verifier.md` and `vibe-review/references/verifier.md` together.
- Bump `version` in `plugins/vibe/.claude-plugin/plugin.json` when releasing.

## Reporting problems

Open an issue with: which skill, which agent, what you said, what the agent did, what you expected. For a broken example, include the version and the error output. For a security hole in the guidance (e.g. an RLS policy that leaks data), describe the attack.
