// src/auth/session.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const REFRESH_KEY = 'auth.refreshToken';
const INSTALLED_KEY = 'app.installed';
const API_URL = process.env.EXPO_PUBLIC_API_URL;   // EXPO_PUBLIC_* được nhúng vào app: không đặt secret ở đây

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export const getAccessToken = () => accessToken;

// Gọi một lần lúc khởi động, trước khi đọc phiên
export async function clearKeychainOnFreshInstall(): Promise<void> {
  if (await AsyncStorage.getItem(INSTALLED_KEY)) return;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  await AsyncStorage.setItem(INSTALLED_KEY, '1');
}

export async function saveSession(tokens: { accessToken: string; refreshToken: string }): Promise<void> {
  accessToken = tokens.accessToken;
  await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,   // không theo bản backup sang máy khác
  });
}

export async function clearSession(): Promise<void> {
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

// Nhiều lời gọi cùng lúc dùng chung một lần refresh
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
      if (!refreshToken) return false;
      const res = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        await clearSession();
        return false;
      }
      await saveSession(await res.json());
      return true;
    } catch {
      return false;                       // mất mạng: giữ phiên, thử lại sau
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}
