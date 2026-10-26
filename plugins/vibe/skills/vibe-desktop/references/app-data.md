# Local data, files and secrets

## Contents
1. Where to put data
2. Tokens and secrets
3. Local DB
4. Offline and sync
5. Multiple tenants and accounts on one machine

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
// main process
const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const sessionFile = () => path.join(app.getPath('userData'), 'session.bin');

async function assertSecureStorage() {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('Hệ điều hành chưa sẵn sàng kho khoá');
  // Linux without a keyring: Electron still "encrypts" with a fixed key, which is no encryption
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('Không có keyring (libsecret/kwallet): không lưu token xuống đĩa');
  }
}

async function saveRefreshToken(token) {
  await assertSecureStorage();
  await fs.writeFile(sessionFile(), await safeStorage.encryptStringAsync(token), { mode: 0o600 });
}

async function loadRefreshToken() {
  try {
    await assertSecureStorage();
    const { result } = await safeStorage.decryptStringAsync(await fs.readFile(sessionFile()));
    return result;
  } catch {
    return null;   // no file, cannot decrypt, or no keystore on this machine: log in again
  }
}
```

- Only the main process reads/writes tokens; the renderer gets a short-lived access token via IPC if it must call the API, or the main process calls the API instead.
- Tauri: use a plugin that stores secrets in the OS keychain (find an official or still-maintained community plugin and read how it stores data); never store tokens in `localStorage` or the plain-file `store` plugin.
- Never embed server secrets (admin API keys, signing keys) in the app: anyone can unpack it.

## 3. Local DB

- SQLite is the default: Electron uses `better-sqlite3` in the main process (a native module: it must be rebuilt for the exact Electron version; Electron Forge/electron-builder handle this); Tauri uses the `sql` plugin or `rusqlite` in commands.
- Local DB migrations are versioned (`PRAGMA user_version`), run at app start; test upgrading from versions several releases old.
- The renderer never runs SQL directly: it calls IPC/commands named by business action (`customers:list`), and main/Rust runs parameterized queries.

## 4. Offline and sync

As on mobile: pick the lowest offline level that meets the need, a write queue with an idempotency key, the server is the source of truth on conflicts (the `vibe-mobile` skill, `references/app-data.md` sections 5–6). Desktop apps run all day, so also:

- Refresh data when the machine wakes from sleep and when the network returns (renderer `online` event, Electron `powerMonitor`).
- Cap the cache size and clean up old data.

## 5. Multiple tenants and accounts on one machine

- A counter machine may be shared by several staff: logout must delete that account's token, cache and local data (as on mobile: the `vibe-mobile` skill, `references/app-data.md` section 7).
- Store local data per tenant (folder or `tenant_id` column) so switching workspace never reads the old workspace's data; tenant goes in the request as on web.
