// test/helpers/memory-usage.ts
import { usageRows, type AiCallContext, type AiUsageStore, type UsageRow } from '../../src/ai/usage';

export function memoryUsage(budgetMicroUsd = 5_000_000) {
  const rows: (AiCallContext & UsageRow)[] = [];
  const store: AiUsageStore = {
    async monthCostMicroUsd(tenantId) {
      return rows.filter((r) => r.tenantId === tenantId).reduce((sum, r) => sum + (r.costMicroUsd ?? 0), 0);
    },
    async monthBudgetMicroUsd() {
      return budgetMicroUsd;
    },
    async record(ctx, model, usage) {
      rows.push(...usageRows(model, usage).map((r) => ({ ...ctx, ...r })));
    },
  };
  return { store, rows };
}
