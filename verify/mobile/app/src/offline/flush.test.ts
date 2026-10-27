// Not in the docs: flushPendingWrites wired to the real session, headers and refresh (fetch mocked)
import { flushPendingWrites } from './flush';
import type { OutboxStore, PendingWrite } from './outbox';
import { getAccessToken, saveSession } from '../auth/session';
import { setUpdateRequiredHandler } from '../api/app-version';

const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { mockSecure.set(k, v); },
  deleteItemAsync: async (k: string) => { mockSecure.delete(k); },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.4.0' }));

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
const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status });
type Call = { url: string; headers: Record<string, string>; body?: string };

function fakeServer(handler: (c: Call) => Response) {
  const calls: Call[] = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const call = { url: String(url), headers: init!.headers as Record<string, string>, body: init!.body as string | undefined };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

beforeEach(async () => {
  jest.restoreAllMocks();
  mockSecure.clear();
  await saveSession({ accessToken: 'a1', refreshToken: 'r1', expiresIn: 900 });
});

test('expired access token: one refresh, then every write goes out with the new token and app headers', async () => {
  const calls = fakeServer((c) => {
    if (c.url.endsWith('/v1/auth/refresh')) return json(200, { data: { accessToken: 'a2', refreshToken: 'r2', expiresIn: 900 } });
    return c.headers.authorization === 'Bearer a2' ? json(201, { data: {} }) : json(401, { error: { code: 'unauthenticated' } });
  });
  const store = memoryStore([write('w1'), write('w2')]);
  const result = await flushPendingWrites(store);
  expect(result.status).toBe('done');
  expect(store.items).toEqual([]);
  expect(calls.map((c) => [c.url.replace(/^.*\/v1/, '/v1'), c.headers.authorization ?? '-'])).toEqual([
    ['/v1/t/t1/customers', 'Bearer a1'],
    ['/v1/auth/refresh', '-'],
    ['/v1/t/t1/customers', 'Bearer a2'],
    ['/v1/t/t1/customers', 'Bearer a2'],
  ]);
  for (const c of calls) expect(c.headers).toMatchObject({ 'x-app-version': '1.4.0', 'x-app-platform': 'ios' });
  expect(calls.filter((c) => !c.url.endsWith('/refresh')).map((c) => c.headers['idempotency-key'])).toEqual(['w1', 'w1', 'w2']);
  expect(mockSecure.get('auth.refreshToken')).toBe('r2');
});

test('refresh token revoked: session cleared, queue kept, auth-required', async () => {
  fakeServer((c) => (c.url.endsWith('/v1/auth/refresh') ? json(401, { error: { code: 'refresh_invalid' } }) : json(401, null)));
  const store = memoryStore([write('w1'), write('w2')]);
  expect((await flushPendingWrites(store)).status).toBe('auth-required');
  expect(store.items.map((w) => w.id)).toEqual(['w1', 'w2']);
  expect(getAccessToken()).toBeNull();
});

test('426 from the server: update handler called, queue kept', async () => {
  const onUpdate = jest.fn();
  setUpdateRequiredHandler(onUpdate);
  fakeServer(() => json(426, { error: { code: 'app_update_required' } }));
  const store = memoryStore([write('w1')]);
  expect((await flushPendingWrites(store)).status).toBe('update-required');
  expect(onUpdate).toHaveBeenCalledTimes(1);
  expect(store.items).toHaveLength(1);
});

test('two triggers at once run one flush', async () => {
  const calls = fakeServer(() => json(201, { data: {} }));
  const store = memoryStore([write('w1')]);
  const [a, b] = await Promise.all([flushPendingWrites(store), flushPendingWrites(store)]);
  expect(a).toBe(b);
  expect(calls).toHaveLength(1);
});
