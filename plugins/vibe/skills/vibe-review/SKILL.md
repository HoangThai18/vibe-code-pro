---
name: vibe-review
description: "Acceptance review before merging a task or closing a phase: run checks on the task's own code, match each acceptance criterion to evidence, have an independent read-only verifier (fresh context) check the diff (security, tenant isolation, migrations, errors, performance, UI, tests), give a PASS / PASS + follow-up / BLOCK verdict in docs/reviews/. Use when asked if a task is done or ready to merge, to close a phase, or after a risky task (auth, tenant data, money, migrations). Loose snippets: checklist only. Also use for Vietnamese requests like 'task này xong chưa', 'review task P1-T03', 'chốt phase', 'sẵn sàng merge chưa'."
---

# Review: acceptance with evidence

Checklist: `references/checklist.md`.

"Done" means there is evidence, not that the author (you included) says so.

## Right-size it

- **Loose code snippet, small PR with no task card**: review against the checklist, answer in chat. Skip steps 1 and 3, write no file.
- **Low-risk task**: self-review against the checklist + steps 1, 2.
- **Risky task (auth, tenant data, money, migrations) and phase close**: all 5 steps.

## Scope and where to run

- **Task**: the code is on the task's branch (`task/<ID>`, or the branch in the subagent's worktree, from its report or `git worktree list`; don't guess the name). Diff: `git diff phase/P1...<branch>`. Run checks **where that code is**: with that branch checked out, or pointed at the worktree (`pnpm --dir <worktree> test`). Checks run on the phase branch pass without ever touching the task's code.
- **Phase**: `git diff main...phase/P1` + the exit criteria in `PHASES.md` + the phase's task cards.

## Step 1: Automated checks

Run the commands in `AGENTS.md`: typecheck, lint, test, build; with a new migration, run it on an empty DB and on a DB with sample data. Record commands and results. Any failure: the verdict is BLOCK; stop and report the specific error.

## Step 2: Match acceptance criteria

Each criterion (or phase exit criterion) needs evidence: test name, command output, screenshot, query result. No evidence counts as not met, even if the code looks right.

## Step 3: Independent verifier

Inputs for the verifier: the diff command, the path where the code is (worktree or branch), the task card or `PHASES.md`, and the checklist path above. If the project's tests need a DB or port, also give a dedicated `DATABASE_URL` and port not used by any running agent (tests resetting each other's DB fail or pass falsely).

- **Your agent supports subagents** (Claude Code, Cursor, Copilot): spawn the `vibe-verifier` subagent (`vibe:vibe-verifier` when installed as a plugin; read-only, never edits).
- **Otherwise**: run the review in a fresh session or context (e.g. the user opens a new chat with a brief you write) given only these inputs and `references/checklist.md`. The reviewer runs read-only commands, never edits, and returns findings (level, `file:line`, scenario, fix) per the checklist plus a suggested verdict.

Give code and requirements, **never your conclusions or reasoning**: the verifier's separate context exists so it isn't anchored to the author's thinking. Small, low-risk diff: a self-review against the checklist is enough.

## Step 4: Classify and give the verdict

Merge findings and drop duplicates; for a serious finding, open the code and confirm it yourself before trusting it.

| Level | Includes |
|---|---|
| 🔴 Blocking | Cross-tenant data leak, auth/authz hole, data loss or corruption, dangerous migration, unmet acceptance criteria, failing tests |
| 🟡 Fix before merge | Wrong error handling, missing tests for important branches, N+1, new query missing an index, UI clearly off-design |
| 🔵 Suggestion | Naming, small refactors, docs |

- **PASS**: no 🔴 or 🟡.
- **PASS + follow-up**: only minor 🟡 and the user agrees to defer them; create a task card for each.
- **BLOCK**: any 🔴, or a 🟡 the user wants fixed now.

## Step 5: Write the report → `docs/reviews/<ID>.md`

Write it in the project docs' language. Example:

```markdown
# Review P1-T03: BLOCK
Date: YYYY-MM-DD · Diff: phase/P1...task/P1-T03

## Automated checks
| Command | Result |
|---|---|
| pnpm typecheck | ✅ |
| pnpm --filter api test | ❌ customers.isolation › cross-tenant PATCH |

## Acceptance criteria
| Criterion | Evidence | Met |
|---|---|---|
| Read/update another tenant's id → 404 | customers.isolation.test.ts | ❌ PATCH returns 200 |

## Findings
### 🔴 PATCH /v1/t/{tenantId}/customers/{id} updates another tenant's customer
- apps/api/src/modules/customers/repo.ts:42: updates by id, outside a transaction with tenant context
- Scenario: a tenant A user sends `PATCH /v1/t/<A>/customers/<B's customer id>` → B's record changes
- Fix: use withTenant() like the read functions; add the case to the table test
```

Update the task card (status, report link) and `docs/STATUS.md`. PASS: return to the `vibe-build` skill to merge. BLOCK: fix on that same branch and rerun. Never downgrade a finding just to let it pass.
