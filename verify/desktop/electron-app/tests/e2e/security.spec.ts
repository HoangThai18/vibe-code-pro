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
