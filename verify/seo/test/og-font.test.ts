// test/og-font.test.ts — the share image must not need the network to draw Vietnamese text
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ogImage } from '../src/lib/og-image';

test('OG image renders Vietnamese without fetching fallback fonts', async () => {
  const fetched: string[] = [];
  const realFetch = globalThis.fetch;
  // next/og fetches glyphs missing from the font from fonts.googleapis.com at render time; offline they become boxes
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith('http')) fetched.push(String(input));
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    const res = await ogImage('Đặt Lịch Spa Hoa Mai', 'Gội đầu dưỡng sinh, chăm sóc da, Quận 3, TP. Hồ Chí Minh');
    const png = Buffer.from(await res.arrayBuffer());
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.deepEqual(fetched, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});
