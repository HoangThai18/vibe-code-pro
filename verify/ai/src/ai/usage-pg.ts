// apps/api/src/ai/usage-pg.ts
import type Anthropic from '@anthropic-ai/sdk';
import type { Pool, PoolClient } from 'pg';
import { costMicroUsd, type AiCallContext, type AiUsageStore } from './usage';

// Tháng tính theo giờ Việt Nam, không theo UTC
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
      return Number(rows[0]?.budget ?? 0);   // không thấy tenant: ngân sách 0, không gọi AI
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
