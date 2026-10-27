// test/stream-draft-reply.test.ts
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { streamDraftReply } from '../src/ai/stream-draft-reply';
import { fakeAnthropic, sseResponse } from './helpers/fake-anthropic';
import { memoryUsage } from './helpers/memory-usage';

async function serve(client: Anthropic, usage: ReturnType<typeof memoryUsage>) {
  const server: Server = createServer((_req, res) => {
    void streamDraftReply({ client, usage: usage.store }, { tenantId: 'spa-a', userId: 'u1' }, 'Mai mình đến muộn 15 phút được không?', res);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

test('stream từng đoạn chữ về trình duyệt, kết thúc bằng done và ghi usage', async () => {
  const { client } = fakeAnthropic([(init) => sseResponse(['Dạ chị ', 'cứ đến ạ.'], init)]);
  const usage = memoryUsage();
  const { server, url } = await serve(client, usage);
  try {
    const text = await (await fetch(url)).text();
    assert.match(text, /event: text\ndata: {"delta":"Dạ chị "}/);
    assert.match(text, /event: done\ndata: {"stopReason":"end_turn"}/);
    assert.equal(usage.rows[0]!.usage.output_tokens, 42);
  } finally {
    server.close();
  }
});

test('người dùng đóng kết nối thì huỷ request tới API', async () => {
  const { client, requests } = fakeAnthropic([(init) => sseResponse(['Dạ '], init, true)]);
  const usage = memoryUsage();
  const { server, url } = await serve(client, usage);
  try {
    const controller = new AbortController();
    const res = await fetch(url, { signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read();                    // đã nhận đoạn đầu
    controller.abort();                     // người dùng đóng trang
    await waitFor(() => requests[0]?.signal?.aborted === true);
    await waitFor(() => usage.rows.length === 1);
    assert.equal(usage.rows[0]!.usage.input_tokens, 800);   // phần đã biết vẫn được ghi
  } finally {
    server.close();
  }
});

async function waitFor(check: () => boolean, timeoutMs = 2_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Hết thời gian chờ');
    await new Promise((r) => setTimeout(r, 10));
  }
}
