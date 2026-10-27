// test/helpers/memory-usage.ts
import type Anthropic from '@anthropic-ai/sdk';
import { costMicroUsd, type AiCallContext, type AiUsageStore } from '../../src/ai/usage';

export function memoryUsage(budgetMicroUsd = 5_000_000) {
  const rows: (AiCallContext & { model: string; usage: Anthropic.Usage; cost: number })[] = [];
  const store: AiUsageStore = {
    async monthCostMicroUsd(tenantId) {
      return rows.filter((r) => r.tenantId === tenantId).reduce((sum, r) => sum + r.cost, 0);
    },
    async monthBudgetMicroUsd() {
      return budgetMicroUsd;
    },
    async record(ctx, model, usage) {
      rows.push({ ...ctx, model, usage, cost: costMicroUsd(model, usage) });
    },
  };
  return { store, rows };
}
