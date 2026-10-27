# Running tasks in parallel

Only when section 0 holds. The default is one agent doing tasks one at a time: each extra agent costs tokens like a separate session, each handoff loses context, and parallel runs add coordination (worktrees, ports, DBs, merges). Worth it only when the time saved clearly outweighs that. Here "agent" means one parallel worker (subagent or separate session); the main session coordinates.

Task script (`scripts/tasks.py` in the `vibe-tasks` skill): `tasks.py next --max-parallel 3` and `tasks.py waves --phase P1 --max-parallel 3`.

## 0. Should you run in parallel?

Only when **all** hold:

- 2+ tasks are ready and touch different files (only `next --max-parallel N` or `waves --max-parallel N` checks and reports file conflicts; plain `next` suggests one task).
- Each task is big enough for its own session (size M or larger). Small tasks are faster one at a time.
- The tasks are independent at runtime: no shared DB with migrations (the script never batches two DB-lane or `migrations/` tasks together), and each agent can get its own port and test DB.
- The user wants to save time and accepts the extra token cost.
- Your agent can run subagents in isolated worktrees (Claude Code, Cursor, Copilot), or the user can run several sessions.

If any fails, work sequentially as in SKILL.md.

## 1. Prepare

1. **Integration branch**: be on `phase/P1` with tests passing.
2. **One worktree per agent, branched from HEAD**:
   - Claude Code: subagents get a worktree via `isolation: "worktree"`. `.claude/settings.json` must contain `{ "worktree": { "baseRef": "head" } }`; by default Claude Code creates subagent worktrees from the remote default branch (usually `origin/main`), so without it the agent doesn't see the phase code. Ask the user before adding it. If your Claude Code version doesn't support `isolation: "worktree"` for subagents, **don't run subagents in parallel**: a worktree you create by hand is not safe, because subagent commands run in the main checkout by default.
   - Separate sessions: create each worktree yourself (`git worktree add -b task/<ID> ../<repo>-<ID> HEAD`) and start the session inside that folder. Another agent's built-in parallel feature is fine if its worktrees branch from the current HEAD.
3. **Permissions**: background agents wait on approval prompts. Suggest the user pre-allow test, typecheck, lint, install, `git add` and `git commit`. Claude Code: every approval a subagent needs pops up in the main session; pre-allow in `permissions.allow`, e.g. `"Bash(pnpm test:*)", "Bash(git commit:*)"`. Never change settings without the user's consent.
4. **Separate runtime per agent**: a worktree separates only files; ports, databases and caches stay shared. Give each agent its own dev server port (3101, 3102...) and its own test DB/schema (e.g. `app_test_p1_t03`).
5. **Commit before spawning**: worktrees start from the HEAD commit, so agents don't see uncommitted changes.

## 2. Spawn

1. Set `status: doing` on the wave's tasks and commit.
2. Start one agent per task, all at once:
   - Claude Code: call the Agent tool once per task **in the same tool-call turn**, with `subagent_type`: `vibe:vibe-implementer` (or `vibe-implementer` if the agent was copied into `.claude/agents/`) and `isolation: "worktree"` (`vibe-implementer` already declares it in its frontmatter; pass it anyway).
   - Other agents: one subagent or session per worktree.
   - Prompt per `references/agent-brief.md`: task card, minimal context, skills to use, own port and DB, boundaries, verify command, report format. The brief is self-contained, so it works for any agent.
3. While agents run: don't do their tasks in the main session. Answer them or pass permission requests to the user; prepare the next wave.

## 3. Collect results (handle each agent as soon as it finishes)

1. Take the worktree and branch **from the agent's report** (Claude Code names them itself, e.g. `worktree-agent-...`); don't guess.
2. Agent reports BLOCKED on a missing permission: ask the user to grant it, then tell the agent to continue (Claude Code: SendMessage). Don't do the work yourself. Missing information: answer the agent, or fix the task card and rerun.
3. Review the diff: `git diff phase/P1...<branch> --stat`, then the full diff. Did the agent change files outside `touches`? Do the tests really check the acceptance criteria?
4. Verify **in the task's worktree** (e.g. `pnpm --dir <worktree> test`, `git -C <worktree> log`), not in the main checkout. Avoid `cd`; it changes the main session's working directory.
5. Set status to `review` and run the `vibe-review` skill with the worktree path and branch (independent verifier for auth, tenant data, money, migrations; self-review against the checklist otherwise). BLOCK: send the findings back to the agent, or fix them on its branch.
6. PASS: the review merges (`git merge --no-ff <branch>`); the main session resolves conflicts itself and reruns all tests in the main checkout.
7. Update the task card (`done`, branch/commit, tick acceptance criteria), check screenshots (UI tasks), then clean up: `git worktree remove <path>`, `git branch -d <branch>`.
8. End of wave: `tasks.py status`, update `docs/STATUS.md`, commit. Before the next wave, recheck section 0: the conditions may no longer hold.
