# Cấu trúc app, đăng nhập, dữ liệu và offline (Expo / React Native)

Ví dụ viết cho Expo SDK 58 (React Native 0.88), TypeScript. Flutter làm theo cùng nguyên tắc, dùng gói tương đương: `flutter_secure_storage` cho token, `go_router` cho điều hướng, `drift` hoặc `sqflite` cho DB cục bộ, `connectivity_plus` cho trạng thái mạng.

## Mục lục
1. Cấu trúc thư mục với Expo Router
2. Đăng nhập và lưu token
3. Gọi API: phiên bản app, tenant, làm mới token
4. Server state: TanStack Query trên mobile
5. Offline: chọn mức cần làm
6. Hàng đợi ghi khi offline (outbox)
7. Đổi workspace và đăng xuất

## 1. Cấu trúc thư mục với Expo Router

```text
apps/mobile/
├── app.config.ts
├── app/                              route theo file (Expo Router)
│   ├── _layout.tsx                   provider: QueryClient, theme, safe area
│   ├── login.tsx
│   ├── update-required.tsx           màn hình buộc cập nhật (release.md mục 6)
│   └── (app)/
│       ├── _layout.tsx               chặn khi chưa đăng nhập
│       └── t/[tenantId]/
│           ├── _layout.tsx
│           └── customers/index.tsx
└── src/
    ├── api/client.ts                 gọi API, header phiên bản, làm mới token
    ├── auth/session.ts               token: bộ nhớ + SecureStore
    ├── offline/outbox.ts             hàng đợi ghi khi offline
    └── features/customers/           hook, component, schema theo tính năng (giống web)
```

Chặn route khi chưa đăng nhập ở layout của nhóm `(app)`:

```tsx
// app/(app)/_layout.tsx
import { Redirect, Stack } from 'expo-router';
import { useSession } from '../../src/auth/use-session';

export default function AppLayout() {
  const { status } = useSession();          // 'loading' | 'signed-in' | 'signed-out'
  if (status === 'loading') return null;    // splash screen vẫn đang hiện
  if (status === 'signed-out') return <Redirect href="/login" />;
  return <Stack />;
}
```

Tenant nằm trong route (`/t/[tenantId]/...`) giống web: deep link, nút back và nhiều luồng chạy song song đều không lẫn workspace.

## 2. Đăng nhập và lưu token

- **Access token chỉ trong bộ nhớ** (mất khi app bị tắt, lấy lại bằng refresh token).
- **Refresh token trong SecureStore** (Keychain trên iOS, Keystore trên Android). Không bao giờ trong AsyncStorage: đó là file thường, đọc được trên máy đã root/jailbreak và đi theo bản backup.
- iOS Keychain có thể **giữ dữ liệu sau khi gỡ app**. AsyncStorage thì bị xoá khi gỡ, nên dùng nó làm dấu "đã cài": lần chạy đầu sau khi cài lại thì xoá token cũ còn sót.
- App đang chạy thật mà trước đây lưu token ở AsyncStorage: bản sửa phải xử lý token của người dùng hiện có. Lúc khởi động, nếu AsyncStorage còn token thì chuyển refresh token sang SecureStore rồi xoá hẳn khỏi AsyncStorage (người dùng không bị đăng xuất), hoặc xoá và yêu cầu đăng nhập lại. Chỉ đổi chỗ đọc/ghi thì token cũ vẫn nằm trong AsyncStorage mãi.
- Nhiều request cùng hết hạn token: chỉ gọi refresh **một lần**. Refresh token xoay vòng (mỗi lần dùng cấp token mới, token cũ bị vô hiệu), gọi hai lần song song là tự làm hỏng phiên.

```ts
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
```

Đăng nhập bằng mật khẩu, OTP, Google/Apple theo skill `backend`, `auth.md` (từ file này: `../../backend/references/auth.md`). Có đăng nhập qua Google/Facebook thì App Store yêu cầu thêm một lựa chọn đăng nhập riêng tư (`release.md` mục 3).

## 3. Gọi API: phiên bản app, tenant, làm mới token

Mỗi request gửi kèm phiên bản app và nền tảng, để server biết bản nào đang gọi và trả `app_update_required` khi bản đó đã quá cũ (skill `backend`, `api-conventions.md` mục 8; từ file này: `../../backend/references/api-conventions.md`).

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
    if (code === 'app_update_required') onUpdateRequired();   // chuyển sang màn hình cập nhật
    throw new ApiError(res.status, code, body?.error?.details);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// Ví dụ: tenant trong path, như web
export const customersApi = {
  list: (tenantId: string) => api<{ data: { id: string; name: string }[] }>(`/v1/t/${tenantId}/customers`),
};
```

## 4. Server state: TanStack Query trên mobile

Dùng như web (key có tenant, `placeholderData` chỉ giữ trong cùng tenant: skill `frontend`, `state-management.md`). Khác web ở hai chỗ: React Native không có sự kiện `online`/`focus` của trình duyệt, nên phải nối với trạng thái mạng và vòng đời app:

```ts
// src/query/setup.ts
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, Platform, type AppStateStatus } from 'react-native';

// Có mạng lại thì query tạm dừng chạy tiếp
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected);
  }),
);

// App quay lại foreground thì làm mới dữ liệu cũ
function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
}
export const appStateSubscription = AppState.addEventListener('change', onAppStateChange);
```

## 5. Offline: chọn mức cần làm

| Mức | Làm gì | Khi nào |
|---|---|---|
| 0. Báo rõ khi offline | Màn hình hiện trạng thái offline, nút thử lại; thao tác ghi bị chặn | Mặc định cho mọi app |
| 1. Đọc được khi offline | Lưu cache query xuống máy (vd persister của TanStack Query) để mở app không có mạng vẫn xem được dữ liệu gần nhất | Người dùng hay mở app ở nơi sóng yếu |
| 2. Ghi được khi offline | Hàng đợi ghi (outbox, mục 6) gửi khi có mạng, kèm idempotency key | Nhập liệu tại hiện trường, kho, đi thị trường |
| 3. Offline-first, đồng bộ hai chiều | DB cục bộ là nguồn chính, đồng bộ với server, giải quyết xung đột | Chỉ khi nghiệp vụ bắt buộc; dùng thư viện đồng bộ có sẵn, đừng tự viết |

- Mức càng cao càng nhiều bug khó: xung đột, dữ liệu lệch, migration DB cục bộ. Chọn mức thấp nhất đáp ứng nghiệp vụ, ghi vào ADR.
- Dữ liệu lưu trên máy là dữ liệu của tenant: xoá khi đăng xuất. Dữ liệu nhạy cảm (sức khoẻ, tài chính) thì cân nhắc không lưu xuống máy, hoặc mã hoá.
- Xung đột: server là nguồn đúng. Bản ghi có `version`; server trả 409 khi bản ghi đã đổi, app báo user và cho tải lại, không âm thầm ghi đè.

## 6. Hàng đợi ghi khi offline (outbox)

Mỗi thao tác ghi được lưu với một id duy nhất; id đó là `Idempotency-Key` khi gửi, nên gửi lại sau khi mất mạng giữa chừng không tạo bản ghi trùng (server lưu kết quả theo key: `api-conventions.md` mục 6). Gửi lần lượt theo thứ tự thêm vào.

```ts
// src/offline/outbox.ts
export type PendingWrite = {
  id: string;                        // dùng làm Idempotency-Key
  tenantId: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;                      // vd /v1/t/<tenantId>/customers
  body: unknown;
  attempts: number;
};

export interface OutboxStore {
  add(write: PendingWrite): Promise<void>;
  list(): Promise<PendingWrite[]>;   // theo thứ tự thêm vào
  remove(id: string): Promise<void>;
  bumpAttempts(id: string): Promise<void>;
}

export type FlushResult = {
  status: 'done' | 'offline' | 'retry-later';
  rejected: { write: PendingWrite; status: number }[];   // server từ chối hẳn: báo user
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
      return { status: 'offline', rejected };              // mất mạng: dừng, giữ nguyên thứ tự
    }
    if (res.ok) {
      await store.remove(write.id);
    } else if (res.status >= 500 || res.status === 429) {
      await store.bumpAttempts(write.id);
      return { status: 'retry-later', rejected };          // lỗi tạm thời: thử lại sau, không nhảy cóc
    } else {
      await store.remove(write.id);                        // 4xx: hết quyền, xung đột, dữ liệu sai
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

Lưu hàng đợi bằng `expo-sqlite` (còn sau khi app bị tắt):

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

- Gọi `flushOutbox` khi có mạng lại (`onlineManager.subscribe`) và khi app vào foreground; sau khi flush thì invalidate query liên quan.
- UI hiện rõ thao tác đang chờ gửi (vd biểu tượng đồng hồ cạnh bản ghi), và báo những thao tác bị từ chối.
- Id tạo bằng `Crypto.randomUUID()` của `expo-crypto`.

## 7. Đổi workspace và đăng xuất

- **Đổi workspace**: điều hướng sang route của tenant mới; bỏ cache của tenant cũ như web (`state-management.md` mục 5). Hàng đợi ghi giữ nguyên: mỗi thao tác đã mang tenant trong path.
- **Đăng xuất** (theo thứ tự): hủy đăng ký push của thiết bị trên server (`platform-features.md` mục 1) → `queryClient.clear()` → xoá cache đã lưu xuống máy và DB cục bộ (kể cả outbox, sau khi báo user nếu còn thao tác chưa gửi) → `clearSession()` → về màn hình đăng nhập.
- Test cả hai luồng trên thiết bị: đăng nhập tài khoản B trên cùng máy không thấy dữ liệu nào của A.
