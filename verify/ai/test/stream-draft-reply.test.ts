// test/stream-draft-reply.test.ts
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { streamDraftReply } from '../src/ai/stream-draft-reply';
import { readDraftStream } from '../web/read-draft-stream';
import { settleDraft } from '../web/settle-draft';
import { fakeAnthropic, sseResponse } from './helpers/fake-anthropic';
import { memoryUsage } from './helpers/memory-usage';

async function serve(client: Anthropic, usage: ReturnType<typeof memoryUsage>) {
  const server: Server = createServer((_req, res) => {
    void streamDraftReply({ client, usage: usage.store }, { tenantId: 'spa-a', userId: 'u1' }, 'Mai mình đến muộn 15 phút được không?', res);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

test('streams text chunks to the browser, ends with done and records usage', async () => {
  const { client } = fakeAnthropic([(init) => sseResponse(['Dạ chị ', 'cứ đến ạ.'], init)]);
  const usage = memoryUsage();
  const { server, url } = await serve(client, usage);
  try {
    let text = '';
    assert.equal(await readDraftStream(url, { m: 'x' }, (d) => (text += d)), 'done');
    assert.equal(text, 'Dạ chị cứ đến ạ.');
    assert.equal(usage.rows[0]!.outputTokens, 42);
  } finally {
    server.close();
  }
});

test('a refused or truncated stream is not reported as a finished draft', async () => {
  for (const [stopReason, result, kept] of [['refusal', 'refused', ''], ['max_tokens', 'truncated', 'Dạ chị ']] as const) {
    const { client } = fakeAnthropic([(init) => sseResponse(['Dạ chị '], init, { stopReason })]);
    const { server, url } = await serve(client, memoryUsage());
    try {
      let text = '';
      assert.equal(await readDraftStream(url, {}, (d) => (text += d)), result);
      const settled = settleDraft(text, result);
      assert.equal(settled.text, kept);                  // refused: the partial text is dropped
      assert.ok(settled.notice);
    } finally {
      server.close();
    }
  }
});

test('user disconnect aborts the API request', async () => {
  const { client, requests } = fakeAnthropic([(init) => sseResponse(['Dạ '], init, { keepOpen: true })]);
  const usage = memoryUsage();
  const { server, url } = await serve(client, usage);
  try {
    const controller = new AbortController();
    const res = await fetch(url, { signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read();                    // first chunk received
    controller.abort();                     // user closes the page
    await waitFor(() => requests[0]?.signal?.aborted === true);
    await waitFor(() => usage.rows.length === 1);
    assert.equal(usage.rows[0]!.inputTokens, 800);   // known usage is still recorded
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
