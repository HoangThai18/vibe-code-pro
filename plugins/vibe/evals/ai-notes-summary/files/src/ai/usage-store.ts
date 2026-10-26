import type Anthropic from '@anthropic-ai/sdk';

export interface AiUsageStore {
  // Tổng chi phí AI của tenant trong tháng này, đơn vị micro-USD
  monthCostMicroUsd(tenantId: string): Promise<number>;
  monthBudgetMicroUsd(tenantId: string): Promise<number>;
  record(entry: { tenantId: string; userId: string; feature: string; model: string; usage: Anthropic.Usage }): Promise<void>;
}
