# Cost, budgets and usage

Code and SQL here ran on PostgreSQL 16 and in the test suite in `testing.md`.

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
-- Per-tenant AI budget (micro-USD; 5_000_000 = 5 USD/month)
ALTER TABLE tenants ADD COLUMN ai_monthly_budget_micro_usd bigint NOT NULL DEFAULT 5000000
  CHECK (ai_monthly_budget_micro_usd >= 0);

CREATE TABLE ai_usage (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants (id),
  user_id            uuid NOT NULL,
  feature            text NOT NULL,
  model              text NOT NULL,
  input_tokens       integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens      integer NOT NULL CHECK (output_tokens >= 0),
  cache_write_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens  integer NOT NULL DEFAULT 0,
  cost_micro_usd     bigint  NOT NULL CHECK (cost_micro_usd >= 0),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_tenant_created ON ai_usage (tenant_id, created_at);
-- If the system uses RLS, add a tenant policy like every other table (backend skill, references/postgres-rls.md)
```

Computing cost from `usage` (stored as integer micro-USD, like every other money amount):

```ts
// apps/api/src/ai/usage.ts
import Anthropic from '@anthropic-ai/sdk';

// USD per 1M tokens, copied from the provider's pricing page; add a row when changing models
const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};

// tokens × (USD / 1M tokens) = micro-USD; store integers, never floats for money
export function costMicroUsd(model: string, usage: Anthropic.Usage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`Chưa có giá cho model ${model}`);
  return Math.round(
    usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead,
  );
}

export interface AiCallContext {
  tenantId: string;
  userId: string;
  feature: string;
}

export interface AiUsageStore {
  monthCostMicroUsd(tenantId: string): Promise<number>;
  monthBudgetMicroUsd(tenantId: string): Promise<number>;
  record(ctx: AiCallContext, model: string, usage: Anthropic.Usage): Promise<void>;
}

export class AiBudgetExceededError extends Error {}
export class AiUnavailableError extends Error {}

export async function assertWithinBudget(store: AiUsageStore, tenantId: string): Promise<void> {
  const [spent, budget] = await Promise.all([store.monthCostMicroUsd(tenantId), store.monthBudgetMicroUsd(tenantId)]);
  if (spent >= budget) throw new AiBudgetExceededError(`Tenant ${tenantId} đã dùng hết ngân sách AI tháng này`);
}

// Transient errors (after SDK retries): report "AI temporarily unavailable"; the main flow keeps working.
// 400, 401, 403, 404 are code or config bugs: rethrow so error tracking catches them.
export function toAiError(err: unknown): unknown {
  if (
    err instanceof Anthropic.RateLimitError ||
    err instanceof Anthropic.InternalServerError ||
    err instanceof Anthropic.APIConnectionError
  ) {
    return new AiUnavailableError('AI tạm thời không dùng được', { cause: err });
  }
  return err;
}
```

```ts
// apps/api/src/ai/usage-pg.ts
import type Anthropic from '@anthropic-ai/sdk';
import type { Pool, PoolClient } from 'pg';
import { costMicroUsd, type AiCallContext, type AiUsageStore } from './usage';

// Month boundaries in Vietnam time, not UTC
const MONTH_START = `date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'`;

export function pgUsageStore(db: Pool | PoolClient): AiUsageStore {
  return {
    async monthCostMicroUsd(tenantId) {
      const { rows } = await db.query<{ total: string }>(
        `SELECT coalesce(sum(cost_micro_usd), 0) AS total FROM ai_usage
          WHERE tenant_id = $1 AND created_at >= ${MONTH_START}`,
        [tenantId],
      );
      return Number(rows[0]!.total);
    },
    async monthBudgetMicroUsd(tenantId) {
      const { rows } = await db.query<{ budget: string }>(
        'SELECT ai_monthly_budget_micro_usd AS budget FROM tenants WHERE id = $1',
        [tenantId],
      );
      return Number(rows[0]?.budget ?? 0);   // tenant not found: budget 0, no AI calls
    },
    async record(ctx: AiCallContext, model: string, usage: Anthropic.Usage) {
      await db.query(
        `INSERT INTO ai_usage (tenant_id, user_id, feature, model, input_tokens, output_tokens,
                               cache_write_tokens, cache_read_tokens, cost_micro_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [ctx.tenantId, ctx.userId, ctx.feature, model, usage.input_tokens, usage.output_tokens,
         usage.cache_creation_input_tokens ?? 0, usage.cache_read_input_tokens ?? 0, costMicroUsd(model, usage)],
      );
    },
  };
}
```

- Record calls that failed midway, were refused or were cancelled too: the tokens used are still billed.
- This table feeds cost reports per tenant and per feature, and alerts on abnormal cost increases (the `vibe-ship` skill, `references/observability.md`).

## 3. Per-tenant budgets

- `assertWithinBudget` runs before every call (example in `integration.md`). Budget exhausted: the endpoint returns a dedicated error code (e.g. 402 `ai_budget_exceeded`); the UI says so clearly and shows how to upgrade.
- Check-then-call means a few parallel requests can overshoot the budget slightly; acceptable for a monthly limit. For a hard cap, reserve first (insert an estimated row, update it after the call) in one transaction with a per-tenant lock.
- Also set a spending limit on the provider account as the last line of defense against a bug that calls the API in a loop.
- Limit calls per user per hour so one person cannot use up the whole tenant's budget (the `vibe-backend` skill, `references/app-security.md`, rate limit section).

## 4. Prompt caching

A prompt prefix that is identical across calls (long system prompt, help docs, tool list) can be cached: the first call writes the cache (a bit more than the input price), later calls read it at a very low price.

- Order: fixed parts first (tools, system prompt, shared docs), variable parts (request data) last. One differing byte early on loses the cache for everything after it: never put the current time or a request id in the system prompt.
- Enable with `cache_control: { type: 'ephemeral' }` (automatically caches the last cacheable block) or set it on individual blocks; prefixes that are too short are not cached, and the minimum depends on the model.
- Verify with numbers: `usage.cache_read_input_tokens` must be above 0 on later calls. Always 0 means something keeps changing the prefix.
- Caching works by prefix, so tenant data sits after the shared part: it need not (and should not) go into the shared cached part.

## 5. Other ways to cut cost

- **Lower effort** for simple tasks (`output_config.effort: 'low'`), re-measured with the eval.
- **Just-enough `max_tokens`**: it is the per-call cost cap.
- **Cache results** in the app: a note summary only needs regenerating when a new note arrives (store the newest note's `updated_at` with it).
- **Call when the user needs it**, not automatically for every record on page load.
- **Batch API** for work that does not need results right away (reclassifying all old tickets, nightly bulk summaries): about half price, results arrive later (up to 24 hours); run it in a background job (the `vibe-backend` skill, `references/jobs.md`).
- **Cheaper model** for high-volume work, only when the eval shows quality holds (`design.md` section 3).
