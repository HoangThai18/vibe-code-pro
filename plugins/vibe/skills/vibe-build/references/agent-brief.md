# Brief template for a parallel agent (implementer)

Use when running in parallel (`references/parallel.md`). A subagent or new session starts with empty context: it has only `AGENTS.md` and what you write here. Write as if handing work to a strong engineer who joined the project today: enough context not to guess, clear boundaries so the work doesn't spread. Replace `{...}` with real values; drop lines that don't apply.

```text
You are working on task {ID} of project {project name}.

## What to do
Read the task card: {docs/tasks/ID-slug.md}. It is the main source of requirements: goal, sub-tasks,
acceptance criteria, how to verify, out of scope.

## Read before coding
- AGENTS.md (commands, conventions, mandatory rules)
- {docs/plan/ARCHITECTURE.md, relevant sections}
- {contract: packages/contracts/src/... or docs/contracts/...}
- {design: docs/design/... and mockups, if the task has UI}
- Code to imitate: {path to a similar, well-built module}
- Skills to use: {backend if the task touches the DB, API or tenant data; frontend if it has UI or state}

## Your own runtime environment
Other agents are running in parallel on the same machine, so:
- Run the dev server on PORT={3101}, not the default port. Stop the server when done.
- Tests that touch the DB use DATABASE_URL={...app_test_p1_t03}. Never use the shared dev DB.
- Work in the current directory (your worktree). Run one simple command at a time; don't chain
  commands with cd/&&/;, because chained commands are often blocked by permissions.

## Boundaries
- Create/edit files only in: {touches}. If you need to change anything outside that, stop and report; don't do it.
- Don't change the API contract or DB schema, and don't add dependencies, unless the task card assigns exactly that.
- Don't edit the task card or docs/STATUS.md; the coordinator updates them from your report.
- Other agents are working on: {other ID: their scope}. Don't touch that scope.

## How to work
1. A new worktree may not have dependencies: run the install command from AGENTS.md first.
2. Follow the sub-tasks; commit after each meaningful step with message "{ID}: <what>".
3. Write or update tests for every acceptance criterion.
4. Run verify: {verify command from the task card}, plus the relevant typecheck and lint.

## Report when done (exactly this format)
- Worktree: <output of pwd> · Branch: <git rev-parse --abbrev-ref HEAD> · Last commit: <git rev-parse HEAD>
- Done: 3–6 bullets
- Files changed: short list
- Verify: commands run + results (paste the pass/fail summary line)
- Acceptance criteria: each one met or not, with evidence (test name, output)
- Screenshots (UI tasks): paths in the worktree
- For the coordinator: decisions you made, risks, unfinished work (or "none")

If blocked, stop early and reply starting with "BLOCKED: <reason> | need: <what>". Examples: a command
denied by permissions (give the exact command), a field missing from the contract, a change needed outside
scope. Never look for a way around a denied command.
```

## Tips for writing the brief

- **Point to files instead of copying them**: the agent reads the task card and contract itself, so the brief stays short but complete. Copy only what isn't in a file, e.g. a decision just settled in chat.
- **State the scope of each parallel agent** so two agents don't edit the same place.
- **Say what "done" means**: a specific verify command, not "test thoroughly".
- **Assign the port and DB in the brief**. If two agents share a port, a verify screenshot may show the other agent's app.
- **Never give a reviewer your conclusions**: a reviewer's brief holds only the code, the requirements and the checklist (see the `vibe-review` skill).
