# Cost, budgets and usage

Code and SQL here ran on PostgreSQL 16 (FORCE RLS) and in the test suite in `testing.md`.

## Contents
1. Estimate before building
2. Record usage for every call
3. Per-tenant budgets
4. Prompt caching
5. Other ways to cut cost

## 1. Estimate before building

Cost per call = input tokens × input price + output tokens × output price (prices per 1M tokens, see the current pricing page; thinking tokens are billed as output). Example, note summary: 2,000 input tokens, 300 output tokens, at USD 4 and USD 20 per 1M tokens:

```text
2,000 × 4 / 1,000,000 + 300 × 20 / 1,000,000 = 0.008 + 0.006 = USD 0.014 per call
× 50 calls/day × 26 days × 200 spas = USD 3,640/month
```

Put this calculation in the PRD. If the number does not fit the selling price, change the design before coding: call less (only when the user clicks), cache results, lower the effort, or try a cheaper model on the same eval set.

Measure real token counts instead of guessing: `usage` in the response (section 2), or `client.messages.countTokens(...)` before the call.

## 2. Record usage for every call

```sql
{{schema.sql}}
```

Computing cost from `usage` (stored as integer micro-USD, like every other money amount):

```ts
{{src/ai/usage.ts}}
```

```ts
{{src/ai/usage-pg.ts}}
```

- Record calls that failed midway, were refused or were cancelled too: the tokens used are still billed.
- `record` runs after the provider billed the call, so it must not fail on data it can't price: a model switched by env var, a new alias, a fallback target. It stores the tokens with `cost_micro_usd` NULL and alerts; add the price row, then backfill from the stored tokens. NULL rows count 0 against the budget until then.
- Cache writes are priced at the 5-minute TTL. If you use 1-hour caching (2× input), price `usage.cache_creation.ephemeral_1h_input_tokens` separately.
- This table feeds cost reports per tenant and per feature, and alerts on abnormal cost increases (the `vibe-ship` skill, `references/observability.md`).

## 3. Per-tenant budgets

- `assertWithinBudget` runs before every call (example in `integration.md`). Budget exhausted: the endpoint returns a dedicated error code (e.g. 402 `ai_budget_exceeded`); the UI says so clearly and shows how to upgrade on web; in App Store/Google Play apps that do not sell through in-app purchase, show a neutral message only (no prices, upgrade buttons or purchase links: the `vibe-mobile` skill, `references/release.md` section 3).
- Check-then-call means a few parallel requests can overshoot the budget slightly; acceptable for a monthly limit. For a hard cap, reserve first (insert an estimated row, update it after the call) in one transaction with a per-tenant lock.
- Also set a spending limit on the provider account as the last line of defense against a bug that calls the API in a loop.
- Limit calls per user per hour so one person cannot use up the whole tenant's budget (the `vibe-backend` skill, `references/app-security.md`, rate limit section).

## 4. Prompt caching

A prompt prefix that is identical across calls can be cached: the first call writes it at 1.25× the input price (5-minute TTL; 2× for 1 hour), later calls read it at 0.05× on `claude-opus-5-5` (about 0.1× on most models). It pays only when the shared part is long and actually reused.

- **Minimum length.** A prefix below the model's minimum (512 tokens on `claude-opus-5-5` and the other current models, 1,024 to 4,096 on some older ones; check the docs for yours) is silently not cached. The few-line system prompts in `integration.md` are far below it: they get no `cache_control`.
- **Single calls that end in per-request data** (summaries, drafts, extraction): one explicit breakpoint on the last shared block, and only when the shared prefix is above the minimum. Never top-level automatic caching here: it puts the breakpoint after the per-request tail, so every call pays the write premium and nothing is read back.
- **Multi-turn chat**: top-level `cache_control: { type: 'ephemeral' }` (automatic caching) fits: the breakpoint follows the end of the history, and each turn reads the previous ones (`chat-and-files.md` section 2).
- Order: fixed parts first (tools, system prompt, shared docs), variable parts last. One differing byte early on loses the cache for everything after it: never put the current time or a request id in the system prompt.
- Verify with numbers: `usage.cache_read_input_tokens` must be above 0 on later calls. Always 0 means the prefix keeps changing or is too short; `cache_creation_input_tokens` on every call with no reads is the surcharge above.
- Caches are per model and per workspace, matched on the exact prefix: one tenant's guide is only ever read by calls that send the same guide.

```ts
{{src/ai/answer-from-guide.ts}}
```

## 5. Other ways to cut cost

- **Lower effort** for simple tasks (`output_config.effort: 'low'`), re-measured with the eval.
- **Just-enough `max_tokens`**: it is the per-call cost cap.
- **Cache results** in the app: a note summary only needs regenerating when a new note arrives (store the newest note's `updated_at` with it).
- **Call when the user needs it**, not automatically for every record on page load.
- **Batch API** for work that does not need results right away (reclassifying all old tickets, nightly bulk summaries): about half price, results arrive later (up to 24 hours); run it in a background job (the `vibe-backend` skill, `references/jobs.md`).
- **Cheaper model** for high-volume work, only when the eval shows quality holds (`design.md` section 3).
