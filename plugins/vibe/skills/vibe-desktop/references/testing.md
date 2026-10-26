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
| Security config (no Node in renderer, navigation blocked, path traversal blocked) | E2E, on every PR (section 3) |
| Install, signing, auto-update | Try the packaged build on each OS before release |

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

Security config is easy to change by mistake (one `nodeIntegration: true` while debugging). Lock it with tests on every PR. The suite below ran with Electron 45 and Playwright 1.64 (100 consecutive runs, no flakes) and caught each deliberately broken app version: `nodeIntegration` on/`contextIsolation` off, path traversal check removed, navigation block removed, new windows allowed, preload also exposing `ipcRenderer` or a generic `invoke(channel)`.

```ts
// tests/e2e/security.spec.ts
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

let app: ElectronApplication;

test.beforeEach(async () => {
  app = await electron.launch({ args: ['.'] });
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
