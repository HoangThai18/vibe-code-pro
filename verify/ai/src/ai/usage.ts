// apps/api/src/ai/usage.ts
import Anthropic from '@anthropic-ai/sdk';

// USD cho 1 triệu token, chép từ trang giá của nhà cung cấp; thêm dòng khi đổi model
const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};

// tokens × (USD / 1 triệu token) = micro-USD; lưu số nguyên, không dùng float cho tiền
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

// Lỗi tạm thời (sau khi SDK đã retry): báo "AI tạm thời không dùng được", luồng chính vẫn chạy.
// 400, 401, 403, 404 là lỗi của code hoặc cấu hình: ném tiếp để error tracking bắt.
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
