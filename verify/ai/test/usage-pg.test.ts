// test/usage-pg.test.ts — chạy với DB test thật (DATABASE_URL)
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import pg from 'pg';
import { pgUsageStore } from '../src/ai/usage-pg';
import { assertWithinBudget, AiBudgetExceededError } from '../src/ai/usage';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
after(() => pool.end());

test('cộng chi phí trong tháng theo tenant và chặn khi vượt ngân sách', async () => {
  const A = '11111111-1111-1111-1111-111111111111';
  await pool.query('UPDATE tenants SET ai_monthly_budget_micro_usd = 20000 WHERE id = $1', [A]);
  const store = pgUsageStore(pool);
  const before = await store.monthCostMicroUsd(A);
  await store.record({ tenantId: A, userId: '33333333-3333-3333-3333-333333333333', feature: 'summarize_notes' },
    'claude-opus-5-5', { input_tokens: 2000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000 } as never);
  assert.equal(await store.monthCostMicroUsd(A), before + 2000 * 4 + 100 * 20 + 1000 * 0.2);
  await assert.rejects(assertWithinBudget(store, A), AiBudgetExceededError);    // 10040 + 10200 >= 20000
  await assertWithinBudget(store, '22222222-2222-2222-2222-222222222222');      // tenant khác không bị ảnh hưởng
});
