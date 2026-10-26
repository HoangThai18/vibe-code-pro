# Chi phí, ngân sách và usage

Code và SQL ở đây đã chạy trên PostgreSQL 16 và trong bộ test ở `testing.md`.

## Mục lục
1. Ước tính trước khi làm
2. Ghi usage từng lần gọi
3. Ngân sách theo tenant
4. Cache prompt
5. Các cách giảm chi phí khác

## 1. Ước tính trước khi làm

Tiền mỗi lần gọi = token vào × giá vào + token ra × giá ra (giá tính theo 1 triệu token, xem trang giá hiện hành; token thinking tính như token ra). Ví dụ tóm tắt ghi chú: 2.000 token vào, 300 token ra, giá 4 USD và 20 USD cho 1 triệu token:

```text
2.000 × 4 / 1.000.000 + 300 × 20 / 1.000.000 = 0,008 + 0,006 = 0,014 USD mỗi lần
× 50 lần/ngày × 26 ngày × 200 spa = 3.640 USD/tháng
```

Đưa phép tính này vào PRD. Nếu con số không hợp với giá bán, sửa thiết kế trước khi code: gọi ít hơn (chỉ khi người dùng bấm), cache kết quả, effort thấp hơn, hoặc thử model rẻ hơn với cùng bộ eval.

Đo số token thật thay vì đoán: `usage` trong response (mục 2), hoặc `client.messages.countTokens(...)` trước khi gọi.

## 2. Ghi usage từng lần gọi

```sql
-- Ngân sách AI theo tenant (micro-USD; 5_000_000 = 5 USD/tháng)
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
-- Hệ thống dùng RLS thì thêm policy theo tenant như mọi bảng khác (skill backend, postgres-rls.md)
```

Cách tính tiền từ `usage` (lưu micro-USD dạng số nguyên, như mọi số tiền khác):

```ts
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
```

```ts
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
```

- Ghi cả lần gọi lỗi giữa chừng, bị từ chối, bị huỷ: token đã dùng vẫn tính tiền.
- Bảng này là nguồn cho báo cáo chi phí theo tenant, theo tính năng, và cho cảnh báo khi chi phí tăng bất thường (skill `ship`, `observability.md`).

## 3. Ngân sách theo tenant

- `assertWithinBudget` chạy trước mỗi lần gọi (ví dụ ở `integration.md`). Hết ngân sách: endpoint trả lỗi có mã riêng (vd 402 `ai_budget_exceeded`), giao diện báo rõ và chỉ cách nâng gói.
- Kiểm rồi mới gọi nên vài request song song có thể vượt ngân sách một chút; với hạn mức theo tháng thì chấp nhận được. Cần chặn cứng thì giữ chỗ trước (ghi một dòng ước tính rồi cập nhật sau khi gọi) trong cùng transaction có khoá theo tenant.
- Đặt thêm hạn mức chi tiêu ở tài khoản nhà cung cấp làm lớp chặn cuối, phòng bug làm vòng lặp gọi API.
- Giới hạn số lần gọi theo người dùng mỗi giờ để một người không dùng hết ngân sách của cả tenant (skill `backend`, `app-security.md` mục rate limit).

## 4. Cache prompt

Phần đầu prompt giống hệt nhau giữa các lần gọi (system prompt dài, tài liệu hướng dẫn, danh sách công cụ) có thể cache: lần đầu ghi cache (đắt hơn giá vào một chút), các lần sau đọc cache với giá rất thấp.

- Thứ tự: phần cố định trước (công cụ, system prompt, tài liệu chung), phần thay đổi (dữ liệu của request) sau cùng. Một byte khác ở phần đầu là mất cache cho mọi thứ phía sau: không đưa thời gian hiện tại, id request vào system prompt.
- Bật bằng `cache_control: { type: 'ephemeral' }` (tự cache khối cuối cùng có thể cache) hoặc đặt trên từng khối; prefix quá ngắn thì không được cache, mức tối thiểu tuỳ model.
- Kiểm bằng số liệu: `usage.cache_read_input_tokens` phải lớn hơn 0 ở các lần gọi sau. Bằng 0 mãi là có thứ làm prefix thay đổi.
- Cache theo prefix, nên dữ liệu tenant nằm sau phần chung: không cần (và không nên) cho dữ liệu tenant vào phần được cache chung.

## 5. Các cách giảm chi phí khác

- **Effort thấp hơn** cho việc đơn giản (`output_config.effort: 'low'`), đo lại bằng eval.
- **`max_tokens` vừa đủ**: là trần chi phí mỗi lần gọi.
- **Cache kết quả** ở phía app: tóm tắt ghi chú chỉ cần tạo lại khi có ghi chú mới (lưu kèm `updated_at` của ghi chú mới nhất).
- **Gọi khi người dùng cần**, không tự chạy cho mọi bản ghi lúc tải trang.
- **Batch API** cho việc không cần kết quả ngay (phân loại lại toàn bộ ticket cũ, tạo tóm tắt hàng loạt ban đêm): rẻ hơn khoảng một nửa, kết quả trả về chậm (tối đa 24 giờ); chạy trong job nền (skill `backend`, `jobs.md`).
- **Model rẻ hơn** cho việc khối lượng lớn, chỉ khi eval cho thấy chất lượng giữ được (`design.md` mục 3).
