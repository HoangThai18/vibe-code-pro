// apps/web/src/features/ai/read-draft-stream.ts
// EventSource chỉ gửi được GET; dùng fetch + đọc luồng để gửi POST có body và cookie đăng nhập
export async function readDraftStream(
  url: string,
  body: unknown,
  onText: (delta: string) => void,
  signal?: AbortSignal,
): Promise<'done' | 'error'> {
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
    if (done) return 'error';   // đóng mà chưa có sự kiện done: coi như lỗi
    buffer += value;
    for (let sep = buffer.indexOf('\n\n'); sep !== -1; sep = buffer.indexOf('\n\n')) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = /^event: (.*)$/m.exec(raw)?.[1];
      const data = JSON.parse(/^data: (.*)$/m.exec(raw)?.[1] ?? 'null') as { delta?: string } | null;
      if (event === 'text' && data?.delta) onText(data.delta);
      if (event === 'done') return 'done';
      if (event === 'error') return 'error';
    }
  }
}
