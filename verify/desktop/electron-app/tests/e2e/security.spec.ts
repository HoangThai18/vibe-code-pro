// tests/e2e/security.spec.ts
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

let app: ElectronApplication;

test.beforeEach(async () => {
  app = await electron.launch({ args: ['.'] });
});

test.afterEach(async () => {
  await app.close();
});

test('renderer không có Node, chỉ thấy đúng các hàm được expose', async () => {
  const win = await app.firstWindow();
  expect(await win.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
  expect(await win.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe('undefined');
  expect(await win.evaluate(() => Object.keys((window as unknown as { api: object }).api).sort()))
    .toEqual(['importCustomersCsv', 'openHelp']);
});

test('cấu hình cửa sổ giữ isolation và sandbox', async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0]!.webContents.getLastWebPreferences();
    return { contextIsolation: p?.contextIsolation, sandbox: p?.sandbox, nodeIntegration: p?.nodeIntegration };
  });
  expect(prefs).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false });
});

test('không điều hướng ra ngoài, không mở cửa sổ mới', async () => {
  const win = await app.firstWindow();
  await win.evaluate(() => { window.location.href = 'https://example.com/'; });
  await expect(win.getByRole('heading', { name: 'Khách hàng' })).toBeVisible();
  expect(win.url()).toBe('app://bundle/index.html');
  expect(await win.evaluate(() => window.open('https://example.com/'))).toBeNull();
  expect(app.windows()).toHaveLength(1);
});

test('scheme app:// không trả file ngoài thư mục giao diện', async () => {
  const win = await app.firstWindow();
  const status = await win.evaluate(async () => (await fetch('app://bundle/%2e%2e/main.js')).status);
  expect(status).toBe(404);
});
