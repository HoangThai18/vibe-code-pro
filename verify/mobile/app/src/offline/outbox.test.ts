// src/offline/outbox.test.ts
import { flushOutbox, type FlushDeps, type OutboxStore, type PendingWrite } from './outbox';

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

const write = (id: string): PendingWrite => ({ id, tenantId: 't1', method: 'POST', path: '/v1/t/t1/customers', body: { fullName: id }, attempts: 0 });
const status = (code: number) => new Response(null, { status: code });
const deps = (overrides: Partial<FlushDeps>): FlushDeps => ({
  send: async () => status(201),
  refreshSession: async () => 'refreshed',
  onUpdateRequired: jest.fn(),
  ...overrides,
});
const ids = (store: { items: PendingWrite[] }) => store.items.map((w) => [w.id, w.attempts]);

test('sends in order; stops when offline and keeps the rest', async () => {
  const store = memoryStore([write('a'), write('b'), write('c')]);
  const sent: string[] = [];
  const result = await flushOutbox(store, deps({
    send: async (w) => {
      if (w.id === 'b') throw new TypeError('Network request failed');
      sent.push(w.id);
      return status(201);
    },
  }));
  expect(result.status).toBe('offline');
  expect(sent).toEqual(['a']);
  expect(ids(store)).toEqual([['b', 0], ['c', 0]]);
});

test.each([500, 503, 408, 425, 429])('%i: retry later, never skip to the next write', async (code) => {
  const store = memoryStore([write('a'), write('b')]);
  const result = await flushOutbox(store, deps({ send: async () => status(code) }));
  expect(result.status).toBe('retry-later');
  expect(ids(store)).toEqual([['a', 1], ['b', 0]]);
});

test.each([400, 403, 404, 409, 422])('%i: removed from the queue and reported to show the user', async (code) => {
  const store = memoryStore([write('a'), write('b')]);
  const result = await flushOutbox(store, deps({ send: async (w) => status(w.id === 'a' ? code : 201) }));
  expect(result.status).toBe('done');
  expect(result.rejected.map((r) => [r.write.id, r.status])).toEqual([['a', code]]);
  expect(store.items).toEqual([]);
});

test('401: refreshes once, resends with the new token, carries on', async () => {
  let token = 'expired';
  const sent: string[] = [];
  const store = memoryStore([write('a'), write('b')]);
  const result = await flushOutbox(store, deps({
    send: async (w) => {
      sent.push(`${w.id}:${token}`);
      return status(token === 'fresh' ? 201 : 401);
    },
    refreshSession: async () => {
      token = 'fresh';
      return 'refreshed';
    },
  }));
  expect(result.status).toBe('done');
  expect(sent).toEqual(['a:expired', 'a:fresh', 'b:fresh']);
  expect(store.items).toEqual([]);
});

test('401 and the refresh token is rejected: stops and keeps every write for after login', async () => {
  const store = memoryStore([write('a'), write('b')]);
  const refreshSession = jest.fn(async () => 'signed-out' as const);
  const result = await flushOutbox(store, deps({ send: async () => status(401), refreshSession }));
  expect(result).toEqual({ status: 'auth-required', rejected: [] });
  expect(refreshSession).toHaveBeenCalledTimes(1);
  expect(ids(store)).toEqual([['a', 0], ['b', 0]]);
});

test('426: opens the update screen and keeps every write', async () => {
  const store = memoryStore([write('a'), write('b')]);
  const onUpdateRequired = jest.fn();
  const result = await flushOutbox(store, deps({ send: async () => status(426), onUpdateRequired }));
  expect(result.status).toBe('update-required');
  expect(onUpdateRequired).toHaveBeenCalledTimes(1);
  expect(ids(store)).toEqual([['a', 0], ['b', 0]]);
});
