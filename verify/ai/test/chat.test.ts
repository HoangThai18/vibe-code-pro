// test/chat.test.ts — real PostgreSQL (FORCE RLS, app role), fake model API
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chatTurn } from '../src/ai/chat';
import { AiUnavailableError } from '../src/ai/errors';
import { pgUsageStore } from '../src/ai/usage-pg';
import { NotFoundError } from '../src/shared/errors';
import { A, B, USER_A, USER_A2, USER_B, admin, app, closeDb, resetDb } from './helpers/db';
import { fakeAnthropic, messageJson } from './helpers/fake-anthropic';

const CONV = 'cccccccc-0000-0000-0000-000000000001';
const usageOf = (input: number) => ({ usage: { input_tokens: input, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });
type Body = { system: string; cache_control?: unknown; messages: { role: string; content: { type: string; text?: string }[] }[] };

before(async () => {
  await resetDb();
  await admin.query('INSERT INTO ai_conversations (tenant_id, id, user_id) VALUES ($1, $2, $3)', [A, CONV, USER_A]);
});
after(closeDb);

test('history comes from the database, replayed as returned; automatic caching on; owner only', async () => {
  const { client, requests } = fakeAnthropic([messageJson('Hôm nay có 12 lịch.', usageOf(900)), messageJson('Chị Lan lúc 15:30.', usageOf(950))]);
  const deps = { pool: app, client, usage: pgUsageStore(app) };
  assert.equal(await chatTurn(deps, { tenantId: A, userId: USER_A }, CONV, 'Hôm nay bao nhiêu lịch?'), 'Hôm nay có 12 lịch.');
  await chatTurn(deps, { tenantId: A, userId: USER_A }, CONV, 'Lịch đầu tiên của ai?');

  const body = requests[1]!.body as Body;
  assert.deepEqual(body.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.deepEqual(body.messages[1]!.content[0], { type: 'thinking', thinking: '', signature: 'sig' });   // unchanged
  assert.deepEqual(body.cache_control, { type: 'ephemeral' });
  assert.doesNotMatch(body.system, /lịch/);

  for (const [tenantId, userId] of [[A, USER_A2], [B, USER_B]] as const) {   // colleague, other tenant
    await assert.rejects(chatTurn(deps, { tenantId, userId }, CONV, 'Cho xem với'), NotFoundError);
  }
  assert.equal(requests.length, 2);
});

test('a long context is replaced by a summary; the new context replays no earlier assistant turn', async () => {
  const { client, requests } = fakeAnthropic([
    messageJson('Dài.', usageOf(45_000)),                       // this call's prompt passes COMPACT_AT_TOKENS
    messageJson('Khách hỏi lịch hôm nay; đã trả lời 12 lịch.'),  // the summary
    messageJson('Dạ, còn 3 lịch chiều.'),
    messageJson('Dạ, 17:00.'),
  ]);
  const deps = { pool: app, client, usage: pgUsageStore(app) };
  const ctx = { tenantId: A, userId: USER_A };
  await chatTurn(deps, ctx, CONV, 'Kể chi tiết.');
  await chatTurn(deps, ctx, CONV, 'Còn lịch chiều không?');
  await chatTurn(deps, ctx, CONV, 'Lịch cuối mấy giờ?');

  const [, summarize, firstAfter, next] = requests.map((r) => r.body as Body);
  assert.match(summarize!.messages.at(-1)!.content[0]!.text!, /^Tóm tắt cuộc trò chuyện/);
  assert.equal(summarize!.messages.length, 7);                  // whole history + the request
  assert.equal(firstAfter!.messages.length, 1);
  assert.match(firstAfter!.messages[0]!.content[0]!.text!, /^Tóm tắt phần trước: "Khách hỏi lịch/);
  assert.equal(firstAfter!.messages[0]!.content[1]!.text, 'Còn lịch chiều không?');
  // The prefix stays byte-identical from turn to turn: the cache keeps hitting
  assert.equal(JSON.stringify(next!.messages[0]), JSON.stringify(firstAfter!.messages[0]));
});

test('content is stored as json: key order survives (jsonb would sort tool inputs)', async () => {
  const content = [{ type: 'tool_use', id: 't1', name: 'find_slot', input: { service: 'massage', day: '2026-10-28' } }];
  await admin.query(`INSERT INTO ai_messages (tenant_id, conversation_id, seq, role, content) VALUES ($1, $2, 1000, 'assistant', $3)`,
    [A, CONV, JSON.stringify(content)]);
  const { rows: [r] } = await admin.query('SELECT content FROM ai_messages WHERE seq = 1000');
  assert.equal(JSON.stringify(r.content), JSON.stringify(content));
  await admin.query('DELETE FROM ai_messages WHERE seq = 1000');
});

test('refused turn: nothing saved, usage recorded', async () => {
  const before = (await admin.query('SELECT count(*)::int AS n FROM ai_messages')).rows[0].n;
  const { client } = fakeAnthropic([messageJson('', { stop_reason: 'refusal', content: [] })]);
  await assert.rejects(chatTurn({ pool: app, client, usage: pgUsageStore(app) }, { tenantId: A, userId: USER_A }, CONV, 'x'),
    AiUnavailableError);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM ai_messages')).rows[0].n, before);
  assert.equal((await admin.query(`SELECT count(*)::int AS n FROM ai_usage WHERE feature = 'chat'`)).rows[0].n, 6);
});
