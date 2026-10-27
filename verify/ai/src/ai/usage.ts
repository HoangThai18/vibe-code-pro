// apps/api/src/ai/usage.ts
import type Anthropic from '@anthropic-ai/sdk';

// USD per 1M tokens (cache write = 5-minute TTL), copied from the provider's pricing page.
// One row per model you call, fallback targets included; a missing row gives cost NULL and an alert, never an error
const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};

export type AiUsage = Anthropic.Usage | Anthropic.Beta.BetaUsage;

export interface UsageRow {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costMicroUsd: number | null;   // null: no price for this model; the tokens are still recorded
}

// One row per billed attempt. With server-side fallbacks the top-level usage covers only the attempt that
// produced the message; usage.iterations lists every attempt, each with its own model (compaction too).
export function usageRows(model: string, usage: AiUsage): UsageRow[] {
  const attempts = 'iterations' in usage && usage.iterations?.length ? usage.iterations : [usage];
  return attempts.map((a) => {
    const row = {
      model: ('model' in a && a.model) || model,
      inputTokens: a.input_tokens,
      outputTokens: a.output_tokens,
      cacheWriteTokens: a.cache_creation_input_tokens ?? 0,
      cacheReadTokens: a.cache_read_input_tokens ?? 0,
    };
    const p = PRICES[row.model];
    // tokens × (USD / 1M tokens) = micro-USD; store integers, never floats for money
    const costMicroUsd = p ? Math.round(row.inputTokens * p.input + row.outputTokens * p.output +
      row.cacheWriteTokens * p.cacheWrite + row.cacheReadTokens * p.cacheRead) : null;
    return { ...row, costMicroUsd };
  });
}

export interface AiCallContext {
  tenantId: string;
  userId: string;
  feature: string;
}

export interface AiUsageStore {
  monthCostMicroUsd(tenantId: string): Promise<number>;
  monthBudgetMicroUsd(tenantId: string): Promise<number>;
  record(ctx: AiCallContext, model: string, usage: AiUsage): Promise<void>;
}

export class AiBudgetExceededError extends Error {}

export async function assertWithinBudget(store: AiUsageStore, tenantId: string): Promise<void> {
  const [spent, budget] = await Promise.all([store.monthCostMicroUsd(tenantId), store.monthBudgetMicroUsd(tenantId)]);
  if (spent >= budget) throw new AiBudgetExceededError(`Tenant ${tenantId} đã dùng hết ngân sách AI tháng này`);
}
