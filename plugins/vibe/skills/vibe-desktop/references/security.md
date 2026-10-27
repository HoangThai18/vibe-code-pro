# Desktop app security: Electron and Tauri

Desktop security bugs cost more than web ones: code runs with the user's privileges on their machine. One XSS in a misconfigured Electron renderer is enough to run arbitrary commands on a customer's computer.

The Electron code below ran on Electron 45; the Playwright tests in `testing.md` section 3 run against this exact code and catch deliberately misconfigured versions. The Tauri files were built with Tauri 2.12.

## Contents
1. Electron: trust model
2. Electron: main process
3. Electron: preload
4. Electron: renderer and CSP
5. Electron: fuses at packaging
6. Tauri: capabilities, CSP, commands
7. Review checklist

## 1. Electron: trust model

- **Main process** (full Node.js privileges): creates windows, reads files, calls the OS.
- **Preload** (sandboxed): the only bridge, exposes a few specific functions to the renderer via `contextBridge`.
- **Renderer** (web page): treat it as untrusted, like any web page. No Node, no `require`, only `window.api`.

Keep three defaults: `contextIsolation: true` (default since Electron 12), `sandbox: true` (default since 20), `nodeIntegration: false` (default since 5). Write them explicitly in code so nobody turns them off by mistake.

One default is unsafe: Electron **grants every web permission request** (camera, microphone, notifications, geolocation...) unless the app sets a handler, so one XSS can switch on the camera. Deny by default with `setPermissionRequestHandler` and `setPermissionCheckHandler` (checked on Electron 45: without them `getUserMedia` succeeds silently).

## 2. Electron: main process

```js
// main.js
const { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ORIGIN = 'app://bundle';
const RENDERER_DIR = path.join(__dirname, 'renderer');
const EXTERNAL_HOSTS = new Set(['example.vn', 'help.example.vn']);   // only these sites may open in the browser
// Web permissions the UI may get, for its own pages only. Electron grants every request by default (camera, microphone, screen...)
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

// Serve the UI over a custom scheme instead of file:// (a file:// page can read every file on the machine)
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function serveRenderer() {
  protocol.handle('app', (request) => {
    const { host, pathname } = new URL(request.url);
    const file = path.resolve(RENDERER_DIR, '.' + decodeURIComponent(pathname));
    // Serve only files inside the UI folder (blocks app://bundle/..%2fmain.js)
    if (host !== 'bundle' || !file.startsWith(RENDERER_DIR + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

// Node's URL gives custom schemes the origin 'null': compare scheme and host instead
function isAppUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'app:' && u.host === 'bundle';
  } catch {
    return false;
  }
}

function lockDownPermissions(ses) {
  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details.requestingUrl));
  });
  // Checks come before requests (navigator.permissions.query, Notification.permission...)
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    ALLOWED_PERMISSIONS.has(permission) && isAppUrl(requestingOrigin));
}

function openExternalSafe(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname)) void shell.openExternal(u.toString());
  } catch {
    // invalid URL: ignore
  }
}

function assertTrustedSender(event) {
  // Compare the sending frame's origin, not its URL (about:blank, blob: do not tell who controls the frame)
  if (event.senderFrame?.origin !== APP_ORIGIN) throw new Error('IPC từ nguồn không tin cậy');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // The page may not navigate elsewhere
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  // No new windows; allowed external links open in the default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  void win.loadURL(`${APP_ORIGIN}/index.html`);
  return win;
}

// Each IPC does one narrow thing. The renderer sends no file path: main opens the file dialog itself.
ipcMain.handle('customers:import-csv', async (event) => {
  assertTrustedSender(event);
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || filePaths.length === 0) return null;
  const { size } = await fs.stat(filePaths[0]);
  if (size > 5 * 1024 * 1024) throw new Error('File lớn hơn 5 MB');
  return fs.readFile(filePaths[0], 'utf8');
});

ipcMain.handle('app:open-help', (event, topic) => {
  assertTrustedSender(event);
  if (typeof topic !== 'string' || !/^[a-z0-9-]{1,40}$/.test(topic)) throw new Error('topic không hợp lệ');
  openExternalSafe(`https://help.example.vn/${topic}`);
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());   // no <webview>
});

app.whenReady().then(() => {
  lockDownPermissions(session.defaultSession);   // and every session you create (session.fromPartition)
  serveRenderer();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

## 3. Electron: preload

```js
// preload.js (sandboxed: can require only 'electron' and a few basic modules)
const { contextBridge, ipcRenderer } = require('electron');

// Expose specific functions; never expose ipcRenderer or take channel names from the renderer
contextBridge.exposeInMainWorld('api', {
  importCustomersCsv: () => ipcRenderer.invoke('customers:import-csv'),
  openHelp: (topic) => ipcRenderer.invoke('app:open-help', topic),
});
```

Common mistake: `exposeInMainWorld('ipc', ipcRenderer)` or `send: (channel, ...args) => ipcRenderer.invoke(channel, ...args)`. The renderer can then call every channel, including ones added later.

## 4. Electron: renderer and CSP

```html
<!-- renderer/index.html -->
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://api.example.vn"
    />
    <title>Spa CRM</title>
  </head>
  <body>
    <main>
      <h1>Khách hàng</h1>
      <button id="import" type="button">Nhập CSV</button>
      <p id="result" role="status"></p>
    </main>
    <script src="app.js"></script>
  </body>
</html>
```

```js
// renderer/app.js: uses only window.api, no Node
document.getElementById('import').addEventListener('click', async () => {
  const text = await window.api.importCustomersCsv();
  if (text === null) return;
  const rows = text.trim().split(/\r?\n/).slice(1).filter(Boolean);   // skip the header row
  document.getElementById('result').textContent = `Đã đọc ${rows.length} khách`;
});
```

- No `'unsafe-inline'` or `'unsafe-eval'` in `script-src`. Bundlers (Vite...) emit separate JS files, so inline is not needed.
- Render user data with `textContent` or through a framework (React escapes), never `innerHTML` with unsanitized data.

## 5. Electron: fuses at packaging

Fuses turn off Electron features the app does not need, written into the executable at packaging (`@electron/fuses`; Electron Forge has `FusesPlugin`, electron-builder has an equivalent option). Recommended:

| Fuse | Set | Why |
|---|---|---|
| `RunAsNode` | off | Blocks running the app binary as `node` via `ELECTRON_RUN_AS_NODE` |
| `EnableNodeOptionsEnvironmentVariable` | off | Blocks injecting Node options via `NODE_OPTIONS` |
| `EnableNodeCliInspectArguments` | off | Blocks attaching a debugger with `--inspect`. E2E needs it on: turn it off only in the release build (`testing.md` section 5) |
| `EnableEmbeddedAsarIntegrityValidation` + `OnlyLoadAppFromAsar` | on | Run only code in an integrity-checked `app.asar` (macOS, Windows) |
| `EnableCookieEncryption` | on | Encrypt cookies on disk |
| `GrantFileProtocolExtraPrivileges` | off | `file://` pages get no extra privileges; the UI uses `app://` and needs none (the `testing.md` section 3 tests pass with it off) |

Check the fuse config on the packaged build: `npx @electron/fuses read --app <app path>`.

## 6. Tauri: capabilities, CSP, commands

Tauri v2 by default lets only code packaged with the app call APIs, and each plugin is usable only with a permission in a capability file:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-window",
  "description": "Quyền của cửa sổ chính",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

(`src-tauri/capabilities/main-window.json`). Grant only the permissions the webview's own JS calls. Here `core:default` is enough: the command below opens the dialog from Rust, which needs no permission, while `dialog:allow-open` would let any script in the webview open dialogs itself (checked on Tauri 2.12: with `core:default` the command opens the dialog and a JS `plugin:dialog|open` call is rejected as not allowed). Do not add `remote.urls` unless a remote page truly must call APIs, and then read Tauri's warning about iframes on Linux and Android.

Set a CSP in `src-tauri/tauri.conf.json` (`app.security.csp`), same principles as Electron. The `create-tauri-app` templates ship `"csp": null`, which means no CSP at all; once one is set, Tauri adds nonces/hashes for the app's own scripts and styles at build time.

Rust commands are a trust boundary, like Electron IPC:

```rust
// src-tauri/src/lib.rs
use tauri_plugin_dialog::DialogExt;

const MAX_CSV_BYTES: u64 = 5 * 1024 * 1024;

// The renderer sends no path: the command opens the file dialog itself (from Rust: no dialog permission needed)
#[tauri::command]
async fn import_customers_csv(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().add_filter("CSV", &["csv"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_CSV_BYTES {
        return Err("File lớn hơn 5 MB".into());
    }
    std::fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![import_customers_csv])
        .run(tauri::generate_context!())
        .expect("không khởi động được app");
}
```

- Commands you register are callable from every window by default; in multi-window apps restrict them with the command manifest (see Tauri docs on `AppManifest::commands`).
- Never write commands that take paths or shell commands from the renderer. If you need the `fs`/`shell` plugins, grant permissions with the narrowest scope.

## 7. Review checklist

- [ ] `contextIsolation`, `sandbox` on; `nodeIntegration`, `webSecurity: false`, `allowRunningInsecureContent`, `experimentalFeatures` absent
- [ ] Preload exposes only specific functions; no `ipcRenderer`, `require` or free-form channel names
- [ ] Every `ipcMain.handle`/`on` checks `senderFrame.origin` and validates parameters; no IPC that reads/writes files at renderer-given paths or runs commands
- [ ] `will-navigate` and `setWindowOpenHandler` block navigation and new windows; `shell.openExternal` only with allowlisted URLs
- [ ] `setPermissionRequestHandler` and `setPermissionCheckHandler` on every session: deny by default, allow listed permissions for the app's own origin only
- [ ] UI loaded via a custom scheme with path traversal blocked; no `file://`, no remote pages in a window with preload
- [ ] CSP has no `unsafe-inline`/`unsafe-eval` in `script-src`
- [ ] Fuses set (section 5, including `GrantFileProtocolExtraPrivileges` off); Electron on a supported version
- [ ] Tauri: capabilities hold only permissions the webview's JS calls; no unneeded `remote.urls`; `app.security.csp` set; commands validate input
