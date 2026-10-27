// test/usage-pg.test.ts — real PostgreSQL (FORCE RLS, app role)
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { pgUsageStore } from '../src/ai/usage-pg';
import { assertWithinBudget, AiBudgetExceededError } from '../src/ai/usage';
import { withFallback } from '../src/ai/with-fallback';
import { A, B, USER_A, admin, app, closeDb, resetDb } from './helpers/db';
import { fakeAnthropic, messageJson } from './helpers/fake-anthropic';

before(resetDb);
after(closeDb);
const ctx = { tenantId: A, userId: USER_A, feature: 'summarize_notes' };
const rows = async (feature: string) => (await admin.query(
  'SELECT model, input_tokens, output_tokens, cost_micro_usd FROM ai_usage WHERE feature = $1 ORDER BY id', [feature])).rows;

test('sums the month per tenant and blocks once over budget; other tenants unaffected', async () => {
  await admin.query('UPDATE tenants SET ai_monthly_budget_micro_usd = 20000 WHERE id = $1', [A]);
  const store = pgUsageStore(app);
  await store.record(ctx, 'claude-opus-5-5',
    { input_tokens: 2000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000 } as never);
  assert.equal(await store.monthCostMicroUsd(A), 2000 * 4 + 100 * 20 + 1000 * 0.2);
  await store.record(ctx, 'claude-opus-5-5', { input_tokens: 2000, output_tokens: 100 } as never);
  await assert.rejects(assertWithinBudget(store, A), AiBudgetExceededError);    // 10200 + 10000 >= 20000
  await assertWithinBudget(store, B);
});

test('unknown model: tokens stored, cost NULL, alert raised, no error', async () => {
  const alerts: string[] = [];
  await pgUsageStore(app, (m) => alerts.push(m)).record({ ...ctx, feature: 'unpriced' }, 'claude-new-9',
    { input_tokens: 500, output_tokens: 50 } as never);
  assert.deepEqual(await rows('unpriced'), [{ model: 'claude-new-9', input_tokens: 500, output_tokens: 50, cost_micro_usd: null }]);
  assert.match(alerts[0]!, /claude-new-9/);
});

test('server-side fallback: one row per attempt, each priced at its own model', async () => {
  const { client, requests } = fakeAnthropic([messageJson('Dạ, bên em mở cửa tới 21h ạ.', {
    model: 'claude-opus-5',
    content: [{ type: 'text', text: 'Dạ, bên em mở cửa tới 21h ạ.' }],
    usage: {   // top level: only the attempt that answered
      input_tokens: 1200, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      iterations: [
        { type: 'message', model: 'claude-opus-5-5', input_tokens: 1200, output_tokens: 0,
          cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null },
        { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 1200, output_tokens: 80,
          cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null },
      ],
    },
  })]);
  await withFallback({ client, usage: pgUsageStore(app) }, { ...ctx, feature: 'fallback' }, 'Mấy giờ đóng cửa?');
  assert.equal((requests[0]!.body as { fallbacks: string }).fallbacks, 'default');
  assert.deepEqual(await rows('fallback'), [
    { model: 'claude-opus-5-5', input_tokens: 1200, output_tokens: 0, cost_micro_usd: '4800' },
    { model: 'claude-opus-5', input_tokens: 1200, output_tokens: 80, cost_micro_usd: String(1200 * 5 + 80 * 25) },
  ]);
});
