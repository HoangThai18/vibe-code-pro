# Tests and evals for AI features

Two different things; do not merge them:

| | Automated tests | Evals |
|---|---|---|
| What it checks | Your code: correct request sent, errors handled, usage recorded, no data leaks | Quality of the model's answers with the current prompt |
| Real API calls | No (fake fetch) | Yes, costs money |
| When to run | Every PR, in CI | When changing prompt, model, effort or how data is fed; and on a schedule |
| Result | Deterministic pass/fail | Score on the case set, compared with the previous run |

The code below ran with Node 22 (`node --test` + `tsx`), `@anthropic-ai/sdk` 1.3 and PostgreSQL 16 (FORCE RLS, app role), 24 tests passing. Removing any single protection from the code made a test fail every time: contact redaction (each phone format), JSON instead of a plain concatenated string for notes, the membership check, usage queries inside `withTenant`, aborting the stream when the user disconnects, the stop-reason check in the browser, usage recording, the budget check, recording without a price, per-attempt pricing, the eval's main-module and zero-case checks, the conversation owner check, compaction, `json` (not `jsonb`) history, nothing saved on a refused turn, file type from the bytes, the size cap.

## Contents
1. Fake client: real SDK, fake fetch
2. Tests for summarizing, streaming and tenant isolation
3. Evals against the real API
4. Monitoring in production

## 1. Fake client: real SDK, fake fetch

Do not mock the whole SDK (it drifts from real behavior). Pass a fake `fetch` into the client: the SDK still builds requests, parses responses and throws the right error classes, and the test can inspect the body sent.

```ts
{{test/helpers/fake-anthropic.ts}}
```

```ts
{{test/helpers/memory-usage.ts}}
```

## 2. Tests for summarizing, streaming and tenant isolation

```ts
{{test/summarize-notes.test.ts}}
```

```ts
{{test/redact.test.ts}}
```

```ts
{{test/stream-draft-reply.test.ts}}
```

Tenant isolation is tested at the endpoint, against a real database: two spas with notes, a call as spa A, and an assertion on the body sent to the model. `test/helpers/db.ts` loads the schema into an empty test database and seeds tenants A and B with their members; `app` connects as the app role, so RLS applies.

```ts
{{test/customer-summary.test.ts}}
```

Other test files (same helpers):

| File | Asserts |
|---|---|
| `usage-pg.test.ts` | month total per tenant, budget block, other tenant unaffected; unknown model: tokens stored, cost NULL, alert, no error; fallback response: one row per attempt, each at its model's price |
| `cost.test.ts` | a model with no price: the summary is still returned, cost NULL; no `cache_control` on the short summary call; an explicit breakpoint on the guide block, none top-level |
| `chat.test.ts` | history read from the database and replayed unchanged (thinking block included), automatic caching on; a colleague or another tenant gets 404 and no API call; compaction: the summary request carries the whole history, the next context is one user message, its prefix byte-identical turn to turn; key order kept; a refused turn saves nothing |
| `attachments.test.ts` | type from the bytes; HTML, executables and files over 5 MB rejected before any API call; image block before the instruction |
| `eval-script.test.ts` | `runEval` scoring and cost; the script runs from a folder named `Dự án eval …`; zero cases exits 1 |

Run: `node --import tsx --test --test-concurrency=1 test/*.test.ts`, with `DATABASE_URL` pointing at a test database.

## 3. Evals against the real API

Build the case set from anonymized real data and from users' "not useful" ratings; start with 20 to 50 cases, including hard cases and injected-instruction cases. Grade with code where possible (required points mentioned, no phone number leaked, injected instruction not followed), because code grading is cheap and stable. For what code cannot grade (tone, fabrication), use a separate model call as judge with explicit criteria.

```json
{{evals/summaries.json}}
```

```ts
{{scripts/eval-summaries.ts}}
```

- Run: `npx tsx scripts/eval-summaries.ts`. Put the pass count and cost in the PR description; compare with the previous run on the same case set.
- Model answers vary between runs: run important cases 3 times and count a pass only if all 3 pass (or per the agreed threshold).
- Do not run evals on every PR (costly, noisy). Run them when a PR changes prompt, model, effort or input data, and on a schedule (e.g. weekly) to catch provider-side changes.
- If your agent has the `claude-api` skill, it has a deeper guide to building eval sets (`build-eval`).

## 4. Monitoring in production

Monitor per feature and per tenant (the `vibe-ship` skill, `references/observability.md`):

- Error rate (`AiUnavailableError`), `refusal` rate, `max_tokens` rate.
- p95 latency (and time to first chunk for streaming).
- Daily cost per tenant from the `ai_usage` table; alert above the usual level, and on any row with `cost_micro_usd` NULL.
- Rate of "not useful" ratings; each week read a few cases and add them to the eval set.
