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
{{electron-app/main.js}}
```

## 3. Electron: preload

```js
{{electron-app/preload.js}}
```

Common mistake: `exposeInMainWorld('ipc', ipcRenderer)` or `send: (channel, ...args) => ipcRenderer.invoke(channel, ...args)`. The renderer can then call every channel, including ones added later.

## 4. Electron: renderer and CSP

```html
{{electron-app/renderer/index.html}}
```

```js
{{electron-app/renderer/app.js}}
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
{{tauri-app/src-tauri/capabilities/main-window.json}}
```

(`src-tauri/capabilities/main-window.json`). Grant only the permissions the webview's own JS calls. Here `core:default` is enough: the command below opens the dialog from Rust, which needs no permission, while `dialog:allow-open` would let any script in the webview open dialogs itself (checked on Tauri 2.12: with `core:default` the command opens the dialog and a JS `plugin:dialog|open` call is rejected as not allowed). Do not add `remote.urls` unless a remote page truly must call APIs, and then read Tauri's warning about iframes on Linux and Android.

Set a CSP in `src-tauri/tauri.conf.json` (`app.security.csp`), same principles as Electron. The `create-tauri-app` templates ship `"csp": null`, which means no CSP at all; once one is set, Tauri adds nonces/hashes for the app's own scripts and styles at build time.

Rust commands are a trust boundary, like Electron IPC:

```rust
{{tauri-app/src-tauri/src/lib.rs}}
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
