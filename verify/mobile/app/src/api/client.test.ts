// Not in the docs: api() headers, one refresh on 401, update screen on 426
import { api, ApiError } from './client';
import { setUpdateRequiredHandler } from './app-version';
import { saveSession } from '../auth/session';

const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { mockSecure.set(k, v); },
  deleteItemAsync: async (k: string) => { mockSecure.delete(k); },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.4.0' }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(async () => {
  jest.restoreAllMocks();
  await saveSession({ accessToken: 'a1', refreshToken: 'r1', expiresIn: 900 });
});

test('401: one shared refresh, then the request is retried with the new token', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const auth = (init!.headers as Record<string, string>).authorization;
    if (String(url).endsWith('/v1/auth/refresh')) return json(200, { data: { accessToken: 'a2', refreshToken: 'r2', expiresIn: 900 } });
    return auth === 'Bearer a2' ? json(200, { data: [] }) : json(401, { error: { code: 'unauthenticated' } });
  });
  await expect(Promise.all([api('/v1/t/t1/customers'), api('/v1/t/t1/appointments')])).resolves.toEqual([{ data: [] }, { data: [] }]);
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/refresh'))).toHaveLength(1);
  for (const [, init] of fetchMock.mock.calls) {
    expect(init!.headers).toMatchObject({ 'x-app-version': '1.4.0', 'x-app-platform': 'ios' });
  }
});

test('426: calls the update handler and throws app_update_required', async () => {
  const onUpdate = jest.fn();
  setUpdateRequiredHandler(onUpdate);
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(json(426, { error: { code: 'app_update_required', details: { minVersion: '1.5.0' } } }));
  const err = await api('/v1/t/t1/customers').catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 426, code: 'app_update_required', details: { minVersion: '1.5.0' } });
  expect(onUpdate).toHaveBeenCalledTimes(1);
});
