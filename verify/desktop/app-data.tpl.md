# Local data, files and secrets

## Contents
1. Where to put data
2. Tokens and secrets
3. API calls: app version, platform, forced update
4. Local DB
5. Offline and sync
6. Multiple tenants and accounts on one machine

## 1. Where to put data

| Type | Electron | Tauri | Notes |
|---|---|---|---|
| App data (DB, cache, config) | `app.getPath('userData')` | `appDataDir()` (`@tauri-apps/api/path`) or `app.path().app_data_dir()` (Rust) | Per OS user |
| Logs | `app.getPath('logs')` | `appLogDir()` | No personal data in logs |
| Temp files | `app.getPath('temp')` | `tempDir()` | Delete after use |
| User-chosen files | OS open/save dialog | `dialog` plugin | Read/write only the file the user just chose |

- Never write to the install folder (Program Files, `/Applications`): often read-only, and wiped on update.
- Never build paths from user data (`path.join(base, userInput)`) without checking the result stays inside `base`.

## 2. Tokens and secrets

Electron's `safeStorage` uses the OS keystore (Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux). Since Electron 44 use the async API; the sync functions (`isEncryptionAvailable`, `encryptString`...) are deprecated in Electron 45. The code below ran on Electron 45, including on Linux without a keyring (saving throws, loading returns `null`, nothing is written):

```js
{{electron-app/session-store.js}}
```

- Only the main process reads/writes tokens and calls the API (section 3); if the renderer truly must call the API itself, give it only a short-lived access token via IPC.
- Tauri: use a plugin that stores secrets in the OS keychain (find an official or still-maintained community plugin and read how it stores data); never store tokens in `localStorage` or the plain-file `store` plugin.
- Never embed server secrets (admin API keys, signing keys) in the app: anyone can unpack it.

## 3. API calls: app version, platform, forced update

The main process calls the API (it holds the tokens). Every request sends `x-app-version` and `x-app-platform` so the server can answer `426 app_update_required` to builds older than its minimum (the `vibe-backend` skill, `references/api-conventions.md` section 8). The server knows only `ios|android|macos|windows|linux` and skips the check for any other value, so map Node's `process.platform`:

```js
{{electron-app/api-client.js}}
```

- `app.getVersion()` returns the `version` from the app's `package.json`; started without one (e.g. `electron main.js`) it returns Electron's own version (checked on Electron 45). Start the app folder, as the tests do.
- `onUpdateRequired`: show a blocking "update required" screen in the renderer and run the auto-update check now (`release.md` section 3); do not keep working with an API that may have changed.
- Token endpoints and refresh rules as on mobile (the `vibe-backend` skill, `references/native-auth.md`; the `vibe-mobile` skill, `references/app-data.md` section 2): one shared refresh at a time, `401 refresh_invalid` clears the session, offline keeps it. The refresh call sends the same two headers.
- The renderer calls IPC handlers named by business action (`customers:list`), which check the sender and validate input (`security.md` section 2), then call `api()`; it never gets the refresh token.

## 4. Local DB

- SQLite is the default: Electron uses `better-sqlite3` in the main process (a native module: it must be rebuilt for the exact Electron version; Electron Forge/electron-builder handle this); Tauri uses the `sql` plugin or `rusqlite` in commands.
- Local DB migrations are versioned (`PRAGMA user_version`), run at app start; test upgrading from versions several releases old.
- The renderer never runs SQL directly: it calls IPC/commands named by business action (`customers:list`), and main/Rust runs parameterized queries.

## 5. Offline and sync

As on mobile: pick the lowest offline level that meets the need, a write queue with an idempotency key, the server is the source of truth on conflicts (the `vibe-mobile` skill, `references/app-data.md` sections 5–6). Desktop apps run all day, so also:

- Refresh data when the machine wakes from sleep and when the network returns (renderer `online` event, Electron `powerMonitor`).
- Cap the cache size and clean up old data.

## 6. Multiple tenants and accounts on one machine

- A counter machine may be shared by several staff: logout must delete that account's token, cache and local data (as on mobile: the `vibe-mobile` skill, `references/app-data.md` section 7).
- Store local data per tenant (folder or `tenant_id` column) so switching workspace never reads the old workspace's data; tenant goes in the request as on web.
