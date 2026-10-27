// apps/web/src/features/ai/read-draft-stream.ts
// EventSource only sends GET; use fetch + stream reading to POST a body with the login cookie
export type DraftResult = 'done' | 'refused' | 'truncated' | 'error';

// The server's done event carries the model's stop_reason: only end_turn is a finished draft
const BY_STOP_REASON: Record<string, DraftResult> = { end_turn: 'done', refusal: 'refused', max_tokens: 'truncated' };

export async function readDraftStream(
  url: string,
  body: unknown,
  onText: (delta: string) => void,
  signal?: AbortSignal,
): Promise<DraftResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return 'error';   // closed without a done event: treat as an error
    buffer += value;
    for (let sep = buffer.indexOf('\n\n'); sep !== -1; sep = buffer.indexOf('\n\n')) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = /^event: (.*)$/m.exec(raw)?.[1];
      const data = JSON.parse(/^data: (.*)$/m.exec(raw)?.[1] ?? 'null') as { delta?: string; stopReason?: string } | null;
      if (event === 'text' && data?.delta) onText(data.delta);
      if (event === 'done') return BY_STOP_REASON[data?.stopReason ?? ''] ?? 'error';
      if (event === 'error') return 'error';
    }
  }
}
