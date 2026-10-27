// src/offline/outbox.test.ts
import { flushOutbox, type OutboxStore, type PendingWrite } from './outbox';

function memoryStore(items: PendingWrite[]): OutboxStore & { items: PendingWrite[] } {
  const store = {
    items: [...items],
    async add(w: PendingWrite) { store.items.push(w); },
    async list() { return [...store.items]; },
    async remove(id: string) { store.items = store.items.filter((w) => w.id !== id); },
    async bumpAttempts(id: string) { store.items = store.items.map((w) => (w.id === id ? { ...w, attempts: w.attempts + 1 } : w)); },
  };
  return store;
}

const write = (id: string): PendingWrite => ({ id, tenantId: 't1', method: 'POST', path: '/v1/t/t1/customers', body: { name: id }, attempts: 0 });
const status = (code: number) => new Response(null, { status: code });

test('gửi theo thứ tự, mất mạng thì dừng và giữ phần còn lại', async () => {
  const store = memoryStore([write('a'), write('b'), write('c')]);
  const sent: string[] = [];
  const result = await flushOutbox(store, async (w) => {
    if (w.id === 'b') throw new TypeError('Network request failed');
    sent.push(w.id);
    return status(201);
  });
  expect(result.status).toBe('offline');
  expect(sent).toEqual(['a']);
  expect(store.items.map((w) => w.id)).toEqual(['b', 'c']);
});

test('lỗi 5xx: thử lại sau, không nhảy sang thao tác sau', async () => {
  const store = memoryStore([write('a'), write('b')]);
  const result = await flushOutbox(store, async () => status(503));
  expect(result.status).toBe('retry-later');
  expect(store.items.map((w) => [w.id, w.attempts])).toEqual([['a', 1], ['b', 0]]);
});

test('4xx: bỏ khỏi hàng đợi và báo lại để hiện cho user', async () => {
  const store = memoryStore([write('a'), write('b')]);
  const result = await flushOutbox(store, async (w) => status(w.id === 'a' ? 409 : 201));
  expect(result.status).toBe('done');
  expect(result.rejected.map((r) => [r.write.id, r.status])).toEqual([['a', 409]]);
  expect(store.items).toEqual([]);
});
