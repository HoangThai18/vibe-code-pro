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
{{app/app/(app)/_layout.tsx}}
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
{{app/src/auth/session.ts}}
```

In the root layout, register `setSignedOutHandler(() => router.replace('/login'))` and `setUpdateRequiredHandler(() => router.replace('/update-required'))` (section 3). Login calls `POST /v1/auth/login`, parses the body with `TokenResponse` and calls `saveSession`. Password, OTP and Apple/Google sign-in: the `vibe-backend` skill (`references/auth.md` sections 3 and 9). With Google/Facebook login, the App Store requires an extra privacy-friendly login option (`release.md` section 3).

## 3. API calls: app version, tenant, token refresh

Every request, refresh included, sends the app version and platform, so the server knows which build is calling and answers `426 app_update_required` when that build is too old (the `vibe-backend` skill, `references/api-conventions.md` section 8).

```ts
{{app/src/api/app-version.ts}}
```

```ts
{{app/src/api/client.ts}}
```

## 4. Server state: TanStack Query on mobile

Use it as on web (keys include tenant, `placeholderData` kept only within the same tenant: the `vibe-frontend` skill, `references/state-management.md`). One difference: React Native has no browser `online`/`focus` events, so wire network state and app lifecycle yourself:

```ts
{{app/src/query/setup.ts}}
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
{{app/src/offline/outbox.ts}}
```

Send with the current session (the token is read per write, so a refresh mid-flush applies to the rest):

```ts
{{app/src/offline/flush.ts}}
```

Persist the queue with `expo-sqlite` (survives the app being killed):

```ts
{{app/src/offline/outbox-sqlite.ts}}
```

- Call `flushPendingWrites` when the network returns (`onlineManager.subscribe`) and when the app enters foreground; invalidate related queries after flushing.
- `auth-required`: the queue belongs to the user who was signed out; remember whose it is (e.g. the user id from login). Flush it after that user signs in again; if another account signs in on the device, delete it (after warning) instead of sending one user's writes with another's token.
- The UI clearly shows pending writes (e.g. a clock icon next to the record), reports rejected ones, and flags writes stuck after several `attempts`.
- Generate ids with `Crypto.randomUUID()` from `expo-crypto`.

## 7. Workspace switch and logout

- **Switch workspace**: navigate to the new tenant's route; drop the old tenant's cache as on web (`state-management.md` section 5). Keep the write queue: each write already carries its tenant in the path.
- **Logout** (in order): `unregisterPush()` (`platform-features.md` section 1) → `POST /v1/auth/logout` with the refresh token (`204`; skip when offline) → `queryClient.clear()` → delete the persisted cache and local DB (including the outbox, after warning the user about unsent writes) → `clearSession()` → back to the login screen.
- Test both flows on a device: logging in as account B on the same device shows none of A's data.
