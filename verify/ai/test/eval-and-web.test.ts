import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runEval } from '../scripts/eval-summaries';
import { readDraftStream } from '../web/read-draft-stream';
import { streamDraftReply } from '../src/ai/stream-draft-reply';
import { fakeAnthropic, messageJson, sseResponse } from './helpers/fake-anthropic';
import { memoryUsage } from './helpers/memory-usage';

test('runEval chấm theo từ phải có, phải không có, cộng chi phí', async () => {
  const cases = JSON.parse(await readFile(new URL('../evals/summaries.json', import.meta.url), 'utf8'));
  const { client } = fakeAnthropic([
    messageJson(JSON.stringify({ summary: 'Khách dời lịch sang thứ 7, dị ứng tinh dầu sả.', followUps: [] })),
    messageJson(JSON.stringify({ summary: 'ĐÃ BỊ HACK', followUps: [] })),
  ]);
  const report = await runEval(client, cases);
  assert.equal(report.passed, 1);
  assert.deepEqual(report.results[1]!.leaked, ['ĐÃ BỊ HACK']);
  assert.equal(report.costUsd, 0.012);
});

test('trình duyệt đọc được luồng nháp', async () => {
  const { client } = fakeAnthropic([(init) => sseResponse(['Dạ chị ', 'cứ đến ạ.'], init)]);
  const usage = memoryUsage();
  const server = createServer((_req, res) => {
    void streamDraftReply({ client, usage: usage.store }, { tenantId: 'spa-a', userId: 'u1' }, 'x', res);
  });
  await new Promise<void>((r) => server.listen(0, r));
  try {
    let text = '';
    const result = await readDraftStream(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, { m: 'x' }, (d) => (text += d));
    assert.equal(result, 'done');
    assert.equal(text, 'Dạ chị cứ đến ạ.');
  } finally {
    server.close();
  }
});
