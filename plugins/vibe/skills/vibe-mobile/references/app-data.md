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
│   ├── _layout.tsx                   provider: QueryClient, theme, safe area
│   ├── login.tsx
│   ├── update-required.tsx           forced-update screen (release.md section 6)
│   └── (app)/
│       ├── _layout.tsx               redirect when signed out
│       └── t/[tenantId]/
│           ├── _layout.tsx
│           └── customers/index.tsx
└── src/
    ├── api/client.ts                 API calls, version headers, token refresh
    ├── auth/session.ts               tokens: memory + SecureStore
    ├── offline/outbox.ts             offline write queue
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
- iOS Keychain can **keep data after the app is uninstalled**. AsyncStorage is wiped on uninstall, so use it as an "installed" marker: on the first launch after reinstall, delete leftover tokens.
- A live app that used to store tokens in AsyncStorage: the fix must handle existing users' tokens. On startup, if AsyncStorage still has a token, move the refresh token to SecureStore and delete it from AsyncStorage for good (user stays signed in), or delete it and require login again. Changing only where you read/write leaves old tokens in AsyncStorage forever.
- Several requests hit an expired token at once: call refresh **once**. Refresh tokens rotate (each use issues a new token and invalidates the old one), so two parallel calls break the session.

```ts
// src/auth/session.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const REFRESH_KEY = 'auth.refreshToken';
const INSTALLED_KEY = 'app.installed';
const API_URL = process.env.EXPO_PUBLIC_API_URL;   // EXPO_PUBLIC_* is embedded in the app: no secrets here

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export const getAccessToken = () => accessToken;

// Call once at startup, before reading the session
export async function clearKeychainOnFreshInstall(): Promise<void> {
  if (await AsyncStorage.getItem(INSTALLED_KEY)) return;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  await AsyncStorage.setItem(INSTALLED_KEY, '1');
}

export async function saveSession(tokens: { accessToken: string; refreshToken: string }): Promise<void> {
  accessToken = tokens.accessToken;
  await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,   // not restored from backup to another device
  });
}

export async function clearSession(): Promise<void> {
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

// Concurrent callers share one refresh
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
      return false;                       // offline: keep the session, retry later
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}
```

Password, OTP and Google/Apple login: see the `vibe-backend` skill (`references/auth.md`). With Google/Facebook login, the App Store requires an extra privacy-friendly login option (`release.md` section 3).

## 3. API calls: app version, tenant, token refresh

Every request sends the app version and platform, so the server knows which build is calling and returns `app_update_required` when that build is too old (the `vibe-backend` skill, `references/api-conventions.md` section 8).

```ts
// src/api/client.ts
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { getAccessToken, refreshSession } from '../auth/session';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details?: unknown) {
    super(code);
  }
}

let onUpdateRequired: () => void = () => {};
export const setUpdateRequiredHandler = (fn: () => void) => { onUpdateRequired = fn; };

export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-app-version': Application.nativeApplicationVersion ?? '0.0.0',
      'x-app-platform': Platform.OS,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (res.status === 401 && !retried && (await refreshSession())) return api<T>(path, init, true);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const code: string = body?.error?.code ?? 'unknown_error';
    if (code === 'app_update_required') onUpdateRequired();   // go to the update screen
    throw new ApiError(res.status, code, body?.error?.details);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// Example: tenant in the path, as on web
export const customersApi = {
  list: (tenantId: string) => api<{ data: { id: string; name: string }[] }>(`/v1/t/${tenantId}/customers`),
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

Each write is stored with a unique id; that id is the `Idempotency-Key` when sending, so resending after a mid-request network drop creates no duplicate (the server stores results by key: `api-conventions.md` section 6). Send in insertion order.

```ts
// src/offline/outbox.ts
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
  status: 'done' | 'offline' | 'retry-later';
  rejected: { write: PendingWrite; status: number }[];   // permanently rejected by the server: tell the user
};

export async function flushOutbox(
  store: OutboxStore,
  send: (write: PendingWrite) => Promise<Response>,
): Promise<FlushResult> {
  const rejected: FlushResult['rejected'] = [];
  for (const write of await store.list()) {
    let res: Response;
    try {
      res = await send(write);
    } catch {
      return { status: 'offline', rejected };              // offline: stop, keep order
    }
    if (res.ok) {
      await store.remove(write.id);
    } else if (res.status >= 500 || res.status === 429) {
      await store.bumpAttempts(write.id);
      return { status: 'retry-later', rejected };          // transient error: retry later, never skip ahead
    } else {
      await store.remove(write.id);                        // 4xx: no permission, conflict, invalid data
      rejected.push({ write, status: res.status });
    }
  }
  return { status: 'done', rejected };
}

export const sendWrite = (apiUrl: string, token: string | null) => (write: PendingWrite) =>
  fetch(`${apiUrl}${write.path}`, {
    method: write.method,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': write.id,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: write.method === 'DELETE' ? undefined : JSON.stringify(write.body),
  });
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

- Call `flushOutbox` when the network returns (`onlineManager.subscribe`) and when the app enters foreground; invalidate related queries after flushing.
- The UI clearly shows pending writes (e.g. a clock icon next to the record) and reports rejected ones.
- Generate ids with `Crypto.randomUUID()` from `expo-crypto`.

## 7. Workspace switch and logout

- **Switch workspace**: navigate to the new tenant's route; drop the old tenant's cache as on web (`state-management.md` section 5). Keep the write queue: each write already carries its tenant in the path.
- **Logout** (in order): unregister the device's push token on the server (`platform-features.md` section 1) → `queryClient.clear()` → delete the persisted cache and local DB (including the outbox, after warning the user about unsent writes) → `clearSession()` → back to the login screen.
- Test both flows on a device: logging in as account B on the same device shows none of A's data.
