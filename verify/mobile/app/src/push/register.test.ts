// Not in the docs: push registration is per device (no tenant in the path) and logout removes it
import { registerForPush, unregisterPush } from './register';
import { api } from '../api/client';

const mockAsync = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockAsync.get(k) ?? null,
    setItem: async (k: string, v: string) => { mockAsync.set(k, v); },
    removeItem: async (k: string) => { mockAsync.delete(k); },
  },
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'p1' } } } } }));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: async () => ({ granted: true }),
  requestPermissionsAsync: async () => ({ granted: true }),
  getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[abc]' }),
}));
jest.mock('../api/client', () => ({ api: jest.fn(async () => undefined) }));

test('registers once per device and unregisters the same token on logout', async () => {
  expect(await registerForPush()).toBe('granted');
  expect(api).toHaveBeenCalledWith('/v1/devices', { method: 'PUT', body: JSON.stringify({ pushToken: 'ExponentPushToken[abc]', platform: 'ios' }) });
  await unregisterPush();
  expect(api).toHaveBeenLastCalledWith('/v1/devices/ExponentPushToken%5Babc%5D', { method: 'DELETE' });
  expect(mockAsync.has('push.token')).toBe(false);
});
