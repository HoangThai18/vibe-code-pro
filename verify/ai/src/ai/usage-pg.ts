// apps/api/src/ai/usage-pg.ts
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant';   // the vibe-backend skill, references/postgres-rls.md section 4
import { usageRows, type AiCallContext, type AiUsageStore } from './usage';

// Month boundaries in Vietnam time, not UTC
const MONTH_START = `date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'`;

// Each query runs inside withTenant, so it works under FORCE RLS. alert: an error log your alerting watches
export function pgUsageStore(pool: Pool, alert: (message: string) => void = console.error): AiUsageStore {
  return {
    monthCostMicroUsd: (tenantId) => withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query<{ total: string }>(
        `SELECT coalesce(sum(cost_micro_usd), 0) AS total FROM ai_usage
          WHERE tenant_id = $1 AND created_at >= ${MONTH_START}`,
        [tenantId],
      );
      return Number(rows[0]!.total);
    }),
    monthBudgetMicroUsd: (tenantId) => withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query<{ budget: string }>(
        'SELECT ai_monthly_budget_micro_usd AS budget FROM tenants WHERE id = $1',
        [tenantId],
      );
      return Number(rows[0]?.budget ?? 0);   // tenant not found: budget 0, no AI calls
    }),
    // Runs after the provider billed the call: never throws for a missing price, always stores the tokens
    async record(ctx: AiCallContext, model: string, usage) {
      const rows = usageRows(model, usage);
      await withTenant(pool, ctx.tenantId, async (db) => {
        for (const r of rows) {
          await db.query(
            `INSERT INTO ai_usage (tenant_id, user_id, feature, model, input_tokens, output_tokens,
                                   cache_write_tokens, cache_read_tokens, cost_micro_usd)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [ctx.tenantId, ctx.userId, ctx.feature, r.model, r.inputTokens, r.outputTokens,
             r.cacheWriteTokens, r.cacheReadTokens, r.costMicroUsd],
          );
        }
      });
      for (const r of rows) if (r.costMicroUsd === null) alert(`ai_usage: no price for model ${r.model} (${ctx.feature})`);
    },
  };
}
