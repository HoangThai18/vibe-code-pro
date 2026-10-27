// test/cost.test.ts — what the summary call costs, and where cache_control goes (cost.md sections 2 and 4)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerFromGuide } from '../src/ai/answer-from-guide';
import { summarizeNotes } from '../src/ai/summarize-notes';
import { fakeAnthropic, messageJson } from './helpers/fake-anthropic';
import { memoryUsage } from './helpers/memory-usage';

const ctx = { tenantId: 'spa-a', userId: 'u1' };
const notes = [{ createdAt: '2026-10-01', text: 'Khách muốn đổi lịch sang thứ 7.' }];

test('a model with no price (env switch, new alias) still returns the summary; cost is null', async () => {
  const { client } = fakeAnthropic([messageJson(JSON.stringify({ summary: 'Ổn.', followUps: [] }), { model: 'claude-new-9' })]);
  const usage = memoryUsage();
  assert.equal((await summarizeNotes({ client, usage: usage.store }, ctx, notes)).summary, 'Ổn.');
  assert.deepEqual([usage.rows[0]!.model, usage.rows[0]!.inputTokens, usage.rows[0]!.costMicroUsd], ['claude-new-9', 1000, null]);
});

test('caching: no breakpoint on short single calls; an explicit one after the shared guide', async () => {
  const { client, requests } = fakeAnthropic([
    messageJson(JSON.stringify({ summary: 'x', followUps: [] })),
    messageJson('Gói 90 phút giá 450.000đ.', { usage: { input_tokens: 40, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 6000 } }),
  ]);
  const usage = memoryUsage();
  await summarizeNotes({ client, usage: usage.store }, ctx, notes);
  assert.doesNotMatch(JSON.stringify(requests[0]!.body), /cache_control/);   // too short to cache: a marker would do nothing
  await answerFromGuide({ client, usage: usage.store }, ctx, 'Bảng giá và quy định...', 'Massage 90 phút bao nhiêu tiền?');
  const body = requests[1]!.body as { cache_control?: unknown; messages: { content: { cache_control?: unknown }[] }[] };
  assert.equal(body.cache_control, undefined);                               // no automatic caching: it would cache the question
  assert.deepEqual(body.messages[0]!.content.map((b) => b.cache_control), [{ type: 'ephemeral' }, undefined]);
  assert.equal(usage.rows[1]!.costMicroUsd, 40 * 4 + 20 * 20 + 6000 * 0.2);
});
