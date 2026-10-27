// test/helpers/fake-anthropic.ts
// Real SDK, only fetch replaced: tests run offline, cost nothing, and can inspect outgoing requests
import Anthropic from '@anthropic-ai/sdk';

type Reply = Response | ((init: RequestInit) => Response);

export function fakeAnthropic(replies: Reply[]) {
  const requests: { body: Record<string, unknown>; signal: AbortSignal | null }[] = [];
  const fetch = async (_url: string | URL | Request, init: RequestInit = {}) => {
    requests.push({ body: JSON.parse(String(init.body)), signal: init.signal ?? null });
    const next = replies.shift();
    if (!next) throw new Error('Hết response giả');
    return typeof next === 'function' ? next(init) : next;
  };
  const client = new Anthropic({ apiKey: 'test-key', maxRetries: 0, fetch });
  return { client, requests };
}

export function messageJson(text: string, overrides: Record<string, unknown> = {}) {
  return Response.json({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...overrides,
  });
}

export function apiError(status: number, type: string) {
  return Response.json({ type: 'error', error: { type, message: type } }, { status });
}

const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

// SSE stream like the real API; keepOpen never ends it (to test a mid-stream abort)
export function sseResponse(texts: string[], init: RequestInit, opts: { keepOpen?: boolean; stopReason?: string } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (s: string) => controller.enqueue(encoder.encode(s));
      push(event('message_start', {
        message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [],
          stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 800, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
      }));
      push(event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }));
      for (const text of texts) push(event('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }));
      init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
      if (opts.keepOpen) return;
      push(event('content_block_stop', { index: 0 }));
      push(event('message_delta', {
        delta: { stop_reason: opts.stopReason ?? 'end_turn', stop_sequence: null }, usage: { output_tokens: 42 } }));
      push(event('message_stop', {}));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}
