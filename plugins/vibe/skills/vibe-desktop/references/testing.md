# Testing desktop apps

Principles as in the `vibe-build` skill (`references/testing.md`). The renderer is a web app: unit and component tests as on web. Desktop-specific parts are the main process, IPC, security config and the packaged build.

## Contents
1. Choose the test level
2. Electron E2E with Playwright
3. Security config tests
4. Tauri
5. Running in CI

## 1. Choose the test level

| What to check | Level |
|---|---|
| Pure logic (pricing, CSV parsing, sync) | Unit, separated from Electron/Tauri |
| Renderer: screens, forms, state | Component tests as on web, mock `window.api` |
| Main process + preload + renderer together, IPC, file dialogs | E2E (Playwright for Electron) |
| Security config (no Node in renderer, navigation blocked, path traversal blocked, permissions denied) | E2E, on every PR (section 3) |
| Install, signing, auto-update | Try the packaged build on each OS before release |

Main-process modules that take Electron APIs as parameters run under plain `node --test`, e.g. the API client (`app-data.md` section 3):

```js
// tests/unit/api-client.test.js (node --test tests/unit/*.test.js: plain Node, no Electron)
const assert = require('node:assert/strict');
const test = require('node:test');
const { ApiError, appPlatform, createApiClient } = require('../../api-client.js');

function client(responses, deps = {}) {
  const calls = [];
  const api = createApiClient(
    { baseUrl: 'https://api.example.vn', getAccessToken: () => 'a1', refreshSession: async () => 'refreshed', onUpdateRequired() {}, ...deps },
    { fetch: async (url, init) => { calls.push({ url, headers: init.headers }); return responses.shift(); }, version: '2.3.0', platform: 'windows' },
  );
  return { api, calls };
}

test('maps the OS to the x-app-platform values the server knows', () => {
  assert.equal(appPlatform('darwin'), 'macos');
  assert.equal(appPlatform('win32'), 'windows');
  assert.equal(appPlatform('linux'), 'linux');
  assert.throws(() => appPlatform('freebsd'), /Unsupported platform/);
});

test('every request sends the app version, platform and token', async () => {
  const { api, calls } = client([Response.json({ data: [] })]);
  assert.deepEqual(await api('/v1/t/t1/customers'), { data: [] });
  assert.equal(calls[0].url, 'https://api.example.vn/v1/t/t1/customers');
  assert.equal(calls[0].headers['x-app-version'], '2.3.0');
  assert.equal(calls[0].headers['x-app-platform'], 'windows');
  assert.equal(calls[0].headers.authorization, 'Bearer a1');
});

test('401: refreshes once and retries', async () => {
  const { api, calls } = client([new Response(null, { status: 401 }), Response.json({ data: [] })]);
  assert.deepEqual(await api('/v1/t/t1/customers'), { data: [] });
  assert.equal(calls.length, 2);
});

test('426: starts the update flow and throws app_update_required', async () => {
  let updates = 0;
  const { api } = client([Response.json({ error: { code: 'app_update_required' } }, { status: 426 })], { onUpdateRequired: () => updates++ });
  await assert.rejects(api('/v1/t/t1/customers'), (e) => e instanceof ApiError && e.status === 426 && e.code === 'app_update_required');
  assert.equal(updates, 1);
});
```

## 2. Electron E2E with Playwright

Playwright can drive Electron apps (the `_electron` API, still experimental): launch the app, get windows, run code in the main process.

```ts
// tests/e2e/app.spec.ts
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let app: ElectronApplication;

test.beforeEach(async () => {
  app = await electron.launch({ args: ['.'] });   // run the app from the repo root (package.json "main")
});

test.afterEach(async () => {
  await app.close();
});

test('imports CSV through the main process file dialog', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-'));
  const csv = path.join(dir, 'khach.csv');
  await fs.writeFile(csv, 'name\nNguyễn Thị Lan\nTrần Văn Minh\n');
  // Playwright cannot click OS dialogs: replace the dialog's result in the main process
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, csv);

  const win = await app.firstWindow();
  await win.getByRole('button', { name: 'Nhập CSV' }).click();
  await expect(win.getByRole('status')).toHaveText('Đã đọc 2 khách');
});
```

## 3. Security config tests

Security config is easy to change by mistake (one `nodeIntegration: true` while debugging). Lock it with tests on every PR. The suite below ran with Electron 45 and Playwright 1.64 (100 consecutive runs, no flakes) and caught each deliberately broken app version: `nodeIntegration` on/`contextIsolation` off, path traversal check removed, navigation block removed, new windows allowed, preload also exposing `ipcRenderer` or a generic `invoke(channel)`, either permission handler removed or allowing everything.

```ts
// tests/e2e/security.spec.ts
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

let app: ElectronApplication;

test.beforeEach(async () => {
  // Fake camera and microphone: without the permission handlers, getUserMedia would succeed
  app = await electron.launch({ args: ['--use-fake-device-for-media-stream', '.'] });
});

test.afterEach(async () => {
  await app.close();
});

test('renderer has no Node and sees only the exposed functions', async () => {
  const win = await app.firstWindow();
  expect(await win.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
  expect(await win.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe('undefined');
  expect(await win.evaluate(() => Object.keys((window as unknown as { api: object }).api).sort()))
    .toEqual(['importCustomersCsv', 'openHelp']);
  // preload adds no other globals (e.g. exposeInMainWorld('ipc', ipcRenderer))
  expect(await win.evaluate(() => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const builtins = new Set(Object.getOwnPropertyNames(frame.contentWindow!));
    frame.remove();
    return Object.getOwnPropertyNames(window).filter((k) => !builtins.has(k));
  })).toEqual(['api']);
});

test('window config keeps isolation and sandbox', async () => {
  await app.firstWindow();   // electron.launch() may return before main creates the window
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    // getLastWebPreferences() exists at runtime but not in electron.d.ts
    const wc = BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): Electron.WebPreferences | null };
    const p = wc.getLastWebPreferences();
    return { contextIsolation: p?.contextIsolation, sandbox: p?.sandbox, nodeIntegration: p?.nodeIntegration };
  });
  expect(prefs).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false });
});

test('no navigation away, no new windows', async () => {
  const win = await app.firstWindow();
  await expect(win.getByRole('heading', { name: 'Khách hàng' })).toBeVisible();   // first page has loaded
  // Attach the listener in the main process before navigating: wait for the navigation to end (cancelled or loaded)
  await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0]!.webContents;
    (globalThis as { navDone?: Promise<string> }).navDone =
      new Promise((resolve) => wc.once('did-stop-loading', () => resolve(wc.getURL())));
  });
  await win.evaluate(() => { window.location.href = 'https://example.com/'; });
  expect(await app.evaluate(() => (globalThis as { navDone?: Promise<string> }).navDone)).toBe('app://bundle/index.html');
  // Playwright never sees a navigation cancelled in will-navigate finish: use evaluate from here, not locators
  expect(await win.evaluate(() => window.open('https://example.com/'))).toBeNull();
  expect(app.windows()).toHaveLength(1);
});

test('app:// scheme serves no files outside the UI folder', async () => {
  const win = await app.firstWindow();
  const status = await win.evaluate(async () => (await fetch('app://bundle/..%2fmain.js')).status);
  expect(status).toBe(404);
});

test('web permissions are denied by default: camera, microphone, notifications', async () => {
  const win = await app.firstWindow();
  const media = await win.evaluate(() =>
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(() => 'granted', (e: Error) => e.name));
  expect(media).toBe('NotAllowedError');
  expect(await win.evaluate(async () => (await navigator.permissions.query({ name: 'camera' as PermissionName })).state)).toBe('denied');
  expect(await win.evaluate(() => Notification.permission)).toBe('denied');
});
```

## 4. Tauri

- Command logic: `cargo test` (separate the handler from dialog and OS calls).
- Renderer: component tests as on web, fake IPC with `mockIPC` from `@tauri-apps/api/mocks`.
- E2E: WebDriver via `tauri-driver` works on Linux and Windows; macOS has no WKWebView driver yet, so test main flows on macOS manually from a checklist.

## 5. Running in CI

- Linux needs a virtual display to open windows: `xvfb-run -a npx playwright test` (install the `xvfb` package).
- OS matrix (`ubuntu-latest`, `windows-latest`, `macos-latest`) for tests and packaging; the section 3 security tests run on every PR.
- Test the packaged build (not only from source) at least before each release: `electron.launch({ executablePath: '<path to executable>' })`.
- Playwright launches Electron with the `--inspect` flag, so a build with the `EnableNodeCliInspectArguments` fuse off (`security.md` section 5) cannot run under `electron.launch` (it times out). Run automated tests on a packaged build with this fuse still on; test the final release build (fuse off) manually from a checklist and verify fuses with `npx @electron/fuses read`.
