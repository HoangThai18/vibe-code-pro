// src/auth/session.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
import { appHeaders } from '../api/app-version';

const REFRESH_KEY = 'auth.refreshToken';
const INSTALLED_KEY = 'app.installed';
const LEGACY_REFRESH_KEY = 'refreshToken';         // where an old release kept the token in AsyncStorage
const API_URL = process.env.EXPO_PUBLIC_API_URL;   // EXPO_PUBLIC_* is embedded in the app: no secrets here
const SECURE = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };   // not restored from backup to another device

// Body of POST /v1/auth/login and /v1/auth/refresh
export const TokenResponse = z.object({
  data: z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresIn: z.number().int().positive(),   // seconds
  }),
});
export type Tokens = z.infer<typeof TokenResponse>['data'];
// refreshed: new tokens saved; signed-out: refresh token rejected, session cleared; unavailable: offline or server error, session kept
export type RefreshResult = 'refreshed' | 'signed-out' | 'unavailable';

let accessToken: string | null = null;
let refreshing: Promise<RefreshResult> | null = null;
let onSignedOut: () => void = () => {};

export const getAccessToken = () => accessToken;
export const setSignedOutHandler = (fn: () => void) => { onSignedOut = fn; };   // e.g. router.replace('/login')

// Call once at startup, before reading the session
export async function prepareTokenStorage(): Promise<void> {
  if (!(await AsyncStorage.getItem(INSTALLED_KEY))) {
    // AsyncStorage is wiped on uninstall, the Keychain is not. Any key here means an update
    // from a release that had no marker yet, not a fresh install: keep the session.
    const freshInstall = (await AsyncStorage.getAllKeys()).length === 0;
    if (freshInstall) await SecureStore.deleteItemAsync(REFRESH_KEY);   // left by an uninstalled copy
    await AsyncStorage.setItem(INSTALLED_KEY, '1');
  }
  // After the fresh-install check, so the token moved here is never wiped
  const legacy = await AsyncStorage.getItem(LEGACY_REFRESH_KEY);
  if (legacy) {
    await SecureStore.setItemAsync(REFRESH_KEY, legacy, SECURE);
    await AsyncStorage.removeItem(LEGACY_REFRESH_KEY);   // delete after the copy: a crash in between only repeats the move
  }
}

export async function saveSession(tokens: Tokens): Promise<void> {
  accessToken = tokens.accessToken;
  await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken, SECURE);
}

export async function clearSession(): Promise<void> {
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

async function endSession(): Promise<RefreshResult> {
  await clearSession();
  onSignedOut();
  return 'signed-out';
}

// Concurrent callers share one refresh: the token rotates, so a second parallel call would reuse the old one
export function refreshSession(): Promise<RefreshResult> {
  refreshing ??= (async (): Promise<RefreshResult> => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
      if (!refreshToken) return await endSession();
      const res = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...appHeaders() },
        body: JSON.stringify({ refreshToken }),
      });
      if (res.status === 401) return await endSession();   // refresh_invalid: expired, revoked or reused
      if (!res.ok) return 'unavailable';                    // 5xx, 429, 426: keep the session
      const parsed = TokenResponse.safeParse(await res.json());
      if (!parsed.success) return 'unavailable';            // unexpected body: save nothing
      await saveSession(parsed.data.data);
      return 'refreshed';
    } catch {
      return 'unavailable';                                 // offline: keep the session, retry later
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}
