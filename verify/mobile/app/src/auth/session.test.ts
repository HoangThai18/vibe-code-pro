// src/auth/session.test.ts
import { getAccessToken, prepareTokenStorage, refreshSession, saveSession, setSignedOutHandler } from './session';

// In-memory Keychain and AsyncStorage (the native modules do not run in Jest)
const mockSecure = new Map<string, string>();
const mockAsync = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { mockSecure.set(k, v); },
  deleteItemAsync: async (k: string) => { mockSecure.delete(k); },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockAsync.get(k) ?? null,
    setItem: async (k: string, v: string) => { mockAsync.set(k, v); },
    removeItem: async (k: string) => { mockAsync.delete(k); },
    getAllKeys: async () => [...mockAsync.keys()],
  },
}));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.4.0' }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const tokens = { accessToken: 'a2', refreshToken: 'r2', expiresIn: 900 };

beforeEach(async () => {
  mockSecure.clear();
  mockAsync.clear();
  jest.restoreAllMocks();
  await saveSession({ accessToken: 'a1', refreshToken: 'r1', expiresIn: 900 });
});

test('fresh install: deletes the token an uninstalled copy left in the Keychain', async () => {
  await prepareTokenStorage();
  expect(mockSecure.has('auth.refreshToken')).toBe(false);
  expect(mockAsync.get('app.installed')).toBe('1');
});

test('update from a release without the marker: keeps the session', async () => {
  mockAsync.set('settings.theme', 'dark');   // written by the old release
  await prepareTokenStorage();
  expect(mockSecure.get('auth.refreshToken')).toBe('r1');
  expect(mockAsync.get('app.installed')).toBe('1');
});

test('update from a release that kept the token in AsyncStorage: moves it, never wipes it', async () => {
  mockSecure.clear();
  mockAsync.set('refreshToken', 'legacy');
  await prepareTokenStorage();
  expect(mockSecure.get('auth.refreshToken')).toBe('legacy');
  expect(mockAsync.has('refreshToken')).toBe(false);
});

test('refresh: one call for concurrent callers, saves the rotated pair from { data }', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { data: tokens }));
  expect(await Promise.all([refreshSession(), refreshSession()])).toEqual(['refreshed', 'refreshed']);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toMatch(/\/v1\/auth\/refresh$/);
  expect(JSON.parse(init!.body as string)).toEqual({ refreshToken: 'r1' });
  expect(init!.headers).toMatchObject({ 'x-app-version': '1.4.0', 'x-app-platform': 'ios' });
  expect(getAccessToken()).toBe('a2');
  expect(mockSecure.get('auth.refreshToken')).toBe('r2');
});

test('refresh: a body without the data envelope saves nothing', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, tokens));
  expect(await refreshSession()).toBe('unavailable');
  expect(mockSecure.get('auth.refreshToken')).toBe('r1');
});

test('refresh: 401 refresh_invalid clears the session and goes to login', async () => {
  const signedOut = jest.fn();
  setSignedOutHandler(signedOut);
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(json(401, { error: { code: 'refresh_invalid', message: 'Phiên đã hết hạn' } }));
  expect(await refreshSession()).toBe('signed-out');
  expect(getAccessToken()).toBeNull();
  expect(mockSecure.has('auth.refreshToken')).toBe(false);
  expect(signedOut).toHaveBeenCalledTimes(1);
});

test('refresh: offline or 5xx keeps the session', async () => {
  jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValueOnce(json(503, null));
  expect(await refreshSession()).toBe('unavailable');
  expect(await refreshSession()).toBe('unavailable');
  expect(getAccessToken()).toBe('a1');
  expect(mockSecure.get('auth.refreshToken')).toBe('r1');
});
