# App structure, login, data and offline (Expo / React Native)

Examples target Expo SDK 58 (React Native 0.88), TypeScript. Flutter follows the same principles with equivalent packages: `flutter_secure_storage` for tokens, `go_router` for navigation, `drift` or `sqflite` for the local DB, `connectivity_plus` for network state.

## Contents
1. Folder structure with Expo Router
2. Login and token storage
3. API calls: app version, tenant, token refresh
4. Server state: TanStack Query on mobile
5. Offline: choose the level you need
6. Offline write queue (outbox)
7. Workspace switch and logout

## 1. Folder structure with Expo Router

```text
apps/mobile/
├── app.config.ts
├── app/                              file-based routes (Expo Router)
│   ├── _layout.tsx                   provider: QueryClient, theme, safe area; sign-out and update handlers
│   ├── login.tsx
│   ├── update-required.tsx           forced-update screen (release.md section 6)
│   └── (app)/
│       ├── _layout.tsx               redirect when signed out
│       └── t/[tenantId]/
│           ├── _layout.tsx
│           └── customers/index.tsx
└── src/
    ├── api/app-version.ts            version headers, update-required handler
    ├── api/client.ts                 API calls, token refresh on 401
    ├── auth/session.ts               tokens: memory + SecureStore, refresh
    ├── offline/outbox.ts             offline write queue
    ├── offline/flush.ts              sends the queue with the current session
    └── features/customers/           hooks, components, schemas by feature (as on web)
```

Guard routes for signed-out users in the `(app)` group layout:

```tsx
// app/(app)/_layout.tsx
import { Redirect, Stack } from 'expo-router';
import { useSession } from '../../src/auth/use-session';

export default function AppLayout() {
  const { status } = useSession();          // 'loading' | 'signed-in' | 'signed-out'
  if (status === 'loading') return null;    // splash screen still showing
  if (status === 'signed-out') return <Redirect href="/login" />;
  return <Stack />;
}
```

Tenant lives in the route (`/t/[tenantId]/...`) as on web: deep links, the back button and parallel flows never mix workspaces.

## 2. Login and token storage

- **Access token only in memory** (lost when the app is killed, recovered with the refresh token).
- **Refresh token in SecureStore** (Keychain on iOS, Keystore on Android). Never in AsyncStorage: it is a plain file, readable on rooted/jailbroken devices and included in backups.
- **Token endpoints** (the `vibe-backend` skill, `references/auth.md` section 9): `POST /v1/auth/login` and `POST /v1/auth/refresh` (body `{ "refreshToken" }`) return `200 { "data": { "accessToken", "refreshToken", "expiresIn" } }`; validate the body with zod before saving anything. Refresh tokens rotate (each use issues a new one; reusing an old one revokes the session), so concurrent requests share **one** refresh. `401 refresh_invalid`: clear the session, go to login. Offline or 5xx: keep the session, retry later.
- **iOS Keychain keeps data after uninstall**, AsyncStorage does not. `prepareTokenStorage()` runs once at startup, before reading the session, in this order:
  1. No `app.installed` marker and AsyncStorage empty: fresh install. Delete the refresh token an earlier install left.
  2. No marker but AsyncStorage has other keys: an update from a release without the marker. Keep the session.
  3. Set the marker.
  4. A refresh token an old release kept in AsyncStorage: copy it to SecureStore, then delete it from AsyncStorage (the user stays signed in). This runs after step 1, so the moved token is never wiped. Changing only where you read/write leaves old tokens in AsyncStorage forever.

  If no earlier release wrote anything to AsyncStorage, step 2 cannot tell an update from a reinstall and those users sign in once more: ship the marker in the first release.

```ts
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
```

In the root layout, register `setSignedOutHandler(() => router.replace('/login'))` and `setUpdateRequiredHandler(() => router.replace('/update-required'))` (section 3). Login calls `POST /v1/auth/login`, parses the body with `TokenResponse` and calls `saveSession`. Password, OTP and Apple/Google sign-in: the `vibe-backend` skill (`references/auth.md` sections 3 and 9). With Google/Facebook login, the App Store requires an extra privacy-friendly login option (`release.md` section 3).

## 3. API calls: app version, tenant, token refresh

Every request, refresh included, sends the app version and platform, so the server knows which build is calling and answers `426 app_update_required` when that build is too old (the `vibe-backend` skill, `references/api-conventions.md` section 8).

```ts
// src/api/app-version.ts
import * as Application from 'expo-application';
import { Platform } from 'react-native';

// Sent on every request, refresh included: builds older than the server's minimum get 426 app_update_required
export const appHeaders = (): Record<string, string> => ({
  'x-app-version': Application.nativeApplicationVersion ?? '0.0.0',
  'x-app-platform': Platform.OS,   // 'ios' | 'android'
});

let onUpdateRequired: () => void = () => {};
export const setUpdateRequiredHandler = (fn: () => void) => { onUpdateRequired = fn; };   // e.g. router.replace('/update-required')
export const notifyUpdateRequired = () => onUpdateRequired();
```

```ts
// src/api/client.ts
import { appHeaders, notifyUpdateRequired } from './app-version';
import { getAccessToken, refreshSession } from '../auth/session';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details?: unknown) {
    super(code);
  }
}

export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...appHeaders(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (res.status === 401 && !retried) {
    // Another call already refreshed: retry with its token. Otherwise refresh once, shared by concurrent calls.
    const current = getAccessToken();
    if ((current && current !== token) || (await refreshSession()) === 'refreshed') return api<T>(path, init, true);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const code: string = body?.error?.code ?? 'unknown_error';
    if (res.status === 426) notifyUpdateRequired();   // app_update_required: go to the update screen
    throw new ApiError(res.status, code, body?.error?.details);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// Example: tenant in the path, as on web
export const customersApi = {
  list: (tenantId: string) => api<{ data: { id: string; fullName: string }[] }>(`/v1/t/${tenantId}/customers`),
};
```

## 4. Server state: TanStack Query on mobile

Use it as on web (keys include tenant, `placeholderData` kept only within the same tenant: the `vibe-frontend` skill, `references/state-management.md`). One difference: React Native has no browser `online`/`focus` events, so wire network state and app lifecycle yourself:

```ts
// src/query/setup.ts
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, Platform, type AppStateStatus } from 'react-native';

// Paused queries resume when the network returns
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected);
  }),
);

// Refresh stale data when the app returns to foreground
function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
}
export const appStateSubscription = AppState.addEventListener('change', onAppStateChange);
```

## 5. Offline: choose the level you need

| Level | What | When |
|---|---|---|
| 0. Say clearly when offline | Screen shows offline state and a retry button; writes are blocked | Default for every app |
| 1. Read offline | Persist the query cache on the device (e.g. TanStack Query persister) so the app opens without network and shows the latest data | Users often open the app with weak signal |
| 2. Write offline | Write queue (outbox, section 6) sent when online, with an idempotency key | Field data entry, warehouses, field sales |
| 3. Offline-first, two-way sync | Local DB is the source, synced with the server, conflicts resolved | Only when the business requires it; use an existing sync library, do not write your own |

- Higher levels bring harder bugs: conflicts, drifting data, local DB migrations. Pick the lowest level that meets the need; record it in the ADR.
- Data on the device is tenant data: delete it on logout. For sensitive data (health, finance), consider not storing it on the device, or encrypt it.
- Conflicts: the server is the source of truth. Records have a `version`; the server returns 409 when a record changed, and the app tells the user and offers a reload, never silently overwrites.

## 6. Offline write queue (outbox)

Each write is stored with a unique id; that id is the `Idempotency-Key` when sending, so resending after a mid-request network drop creates no duplicate (the server stores results by key: `api-conventions.md` section 6). Send in insertion order. A write leaves the queue only when the server accepted it or will never accept it:

| Response | Write | Flush |
|---|---|---|
| 2xx | Removed | Continues |
| 401 | Kept | Refreshes once and resends; still 401 or refresh rejected: stops, `auth-required` |
| 426 | Kept | Calls the update handler, stops, `update-required` |
| 400, 403, 404, 409, 422 | Removed, returned in `rejected` | Continues |
| 5xx, 408, 425, 429, any other | Kept, `attempts` + 1 | Stops, `retry-later` |
| Network error | Kept | Stops, `offline` |

```ts
// src/offline/outbox.ts
import type { RefreshResult } from '../auth/session';

export type PendingWrite = {
  id: string;                        // used as the Idempotency-Key
  tenantId: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;                      // e.g. /v1/t/<tenantId>/customers
  body: unknown;
  attempts: number;
};

export interface OutboxStore {
  add(write: PendingWrite): Promise<void>;
  list(): Promise<PendingWrite[]>;   // in insertion order
  remove(id: string): Promise<void>;
  bumpAttempts(id: string): Promise<void>;
}

export type FlushResult = {
  // auth-required, update-required: stopped with the queue kept; it is sent after login, or by the updated app
  status: 'done' | 'offline' | 'retry-later' | 'auth-required' | 'update-required';
  rejected: { write: PendingWrite; status: number }[];   // permanently rejected by the server: tell the user
};

export type FlushDeps = {
  send: (write: PendingWrite) => Promise<Response>;      // reads the current access token on every call
  refreshSession: () => Promise<RefreshResult>;
  onUpdateRequired: () => void;
};

// The server will never accept these: drop the write and report it. Every other error keeps it.
const REJECTED = new Set([400, 403, 404, 409, 422]);

export async function flushOutbox(store: OutboxStore, deps: FlushDeps): Promise<FlushResult> {
  const rejected: FlushResult['rejected'] = [];
  let refreshed = false;
  for (const write of await store.list()) {
    let res: Response;
    try {
      res = await deps.send(write);
      if (res.status === 401 && !refreshed) {
        refreshed = true;                                  // at most one refresh per flush
        const result = await deps.refreshSession();
        if (result === 'unavailable') return { status: 'retry-later', rejected };
        if (result === 'refreshed') res = await deps.send(write);
      }
    } catch {
      return { status: 'offline', rejected };              // offline: stop, keep order
    }
    if (res.ok) {
      await store.remove(write.id);
    } else if (res.status === 401) {
      return { status: 'auth-required', rejected };        // session gone: keep the queue for after login
    } else if (res.status === 426) {
      deps.onUpdateRequired();
      return { status: 'update-required', rejected };
    } else if (REJECTED.has(res.status)) {
      await store.remove(write.id);                        // invalid data, no permission, record gone, conflict
      rejected.push({ write, status: res.status });
    } else {
      await store.bumpAttempts(write.id);                  // 5xx, 408, 425, 429, anything else: retry later, never skip ahead
      return { status: 'retry-later', rejected };
    }
  }
  return { status: 'done', rejected };
}
```

Send with the current session (the token is read per write, so a refresh mid-flush applies to the rest):

```ts
// src/offline/flush.ts
import { appHeaders, notifyUpdateRequired } from '../api/app-version';
import { getAccessToken, refreshSession } from '../auth/session';
import { flushOutbox, type FlushResult, type OutboxStore, type PendingWrite } from './outbox';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export function sendWrite(write: PendingWrite): Promise<Response> {
  const token = getAccessToken();   // read per write: a refresh during the flush replaces it
  return fetch(`${API_URL}${write.path}`, {
    method: write.method,
    headers: {
      'content-type': 'application/json',
      ...appHeaders(),
      'idempotency-key': write.id,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: write.method === 'DELETE' ? undefined : JSON.stringify(write.body),
  });
}

let running: Promise<FlushResult> | null = null;

// Network back and app in foreground can fire together: one flush at a time
export function flushPendingWrites(store: OutboxStore): Promise<FlushResult> {
  running ??= flushOutbox(store, { send: sendWrite, refreshSession, onUpdateRequired: notifyUpdateRequired })
    .finally(() => { running = null; });
  return running;
}
```

Persist the queue with `expo-sqlite` (survives the app being killed):

```ts
// src/offline/outbox-sqlite.ts
import * as SQLite from 'expo-sqlite';
import type { OutboxStore, PendingWrite } from './outbox';

type Row = { id: string; tenant_id: string; method: PendingWrite['method']; path: string; body: string; attempts: number };

export async function openOutboxStore(): Promise<OutboxStore> {
  const db = await SQLite.openDatabaseAsync('app.db');
  await db.execAsync(`CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL,
    body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
  return {
    async add(w) {
      await db.runAsync(
        'INSERT INTO outbox (id, tenant_id, method, path, body, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        w.id, w.tenantId, w.method, w.path, JSON.stringify(w.body ?? null), w.attempts, Date.now(),
      );
    },
    async list() {
      const rows = await db.getAllAsync<Row>('SELECT * FROM outbox ORDER BY created_at, rowid');
      return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id, method: r.method, path: r.path, body: JSON.parse(r.body), attempts: r.attempts }));
    },
    async remove(id) { await db.runAsync('DELETE FROM outbox WHERE id = ?', id); },
    async bumpAttempts(id) { await db.runAsync('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?', id); },
  };
}
```

- Call `flushPendingWrites` when the network returns (`onlineManager.subscribe`) and when the app enters foreground; invalidate related queries after flushing.
- `auth-required`: the queue belongs to the user who was signed out; remember whose it is (e.g. the user id from login). Flush it after that user signs in again; if another account signs in on the device, delete it (after warning) instead of sending one user's writes with another's token.
- The UI clearly shows pending writes (e.g. a clock icon next to the record), reports rejected ones, and flags writes stuck after several `attempts`.
- Generate ids with `Crypto.randomUUID()` from `expo-crypto`.

## 7. Workspace switch and logout

- **Switch workspace**: navigate to the new tenant's route; drop the old tenant's cache as on web (`state-management.md` section 5). Keep the write queue: each write already carries its tenant in the path.
- **Logout** (in order): `unregisterPush()` (`platform-features.md` section 1) → `POST /v1/auth/logout` with the refresh token (`204`; skip when offline) → `queryClient.clear()` → delete the persisted cache and local DB (including the outbox, after warning the user about unsent writes) → `clearSession()` → back to the login screen.
- Test both flows on a device: logging in as account B on the same device shows none of A's data.
