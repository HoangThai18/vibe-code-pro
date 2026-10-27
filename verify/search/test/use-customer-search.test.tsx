// test/use-customer-search.test.tsx: node --import tsx --import global-jsdom/register --test
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCustomerSearch } from '../web/use-customer-search';

type Call = { url: string; signal: AbortSignal | undefined };
let calls: Call[];
const LATENCY_MS = 600;  // slower than the 250 ms debounce, so a newer query starts while one is in flight

beforeEach(() => {
  calls = [];
  mock.method(globalThis, 'fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url, signal: init.signal ?? undefined });
    const q = new URL(url, 'http://x').searchParams.get('q');
    return new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      setTimeout(() => resolve(Response.json({ data: [{ id: '1', fullName: `hit for ${q}` }] })), LATENCY_MS);
    });
  });
});
afterEach(() => {
  cleanup();  // node:test has no global afterEach, so Testing Library cannot unmount by itself
  mock.restoreAll();
});

function setup(tenantId: string, input: string) {
  // gcTime: Infinity: no garbage-collection timer keeps the test process alive
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(({ t, q }) => useCustomerSearch(t, q), { wrapper, initialProps: { t: tenantId, q: input } });
}

const sleep = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

test('fast typing sends one request, for the final text', async () => {
  const { result, rerender } = setup('A', '');
  for (const q of ['n', 'ng', 'ngu', 'nguy']) {
    rerender({ t: 'A', q });
    await sleep(50);
  }
  await waitFor(() => assert.deepEqual(result.current.data, [{ id: '1', fullName: 'hit for nguy' }]), { timeout: 2000 });
  assert.equal(calls.length, 1);
});

test('one character sends nothing', async () => {
  setup('A', 'n');
  await sleep(400);
  assert.equal(calls.length, 0);
});

test('a newer query aborts the request still in flight', async () => {
  const { result, rerender } = setup('A', 'thao');
  await waitFor(() => assert.equal(calls.length, 1));
  rerender({ t: 'A', q: 'thao ng' });
  await waitFor(() => assert.equal(calls.length, 2));
  assert.equal(calls[0]!.signal?.aborted, true);
  await waitFor(() => assert.deepEqual(result.current.data, [{ id: '1', fullName: 'hit for thao ng' }]), { timeout: 2000 });
});

test("switching workspace never shows the old workspace's results", async () => {
  const { result, rerender } = setup('A', 'thao');
  await waitFor(() => assert.ok(result.current.data), { timeout: 2000 });
  rerender({ t: 'B', q: 'thao' });
  assert.equal(result.current.data, undefined);
});
