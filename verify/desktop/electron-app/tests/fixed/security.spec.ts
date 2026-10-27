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
  // preload không gắn thêm biến toàn cục nào khác (vd exposeInMainWorld('ipc', ipcRenderer))
  expect(await win.evaluate(() => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const builtins = new Set(Object.getOwnPropertyNames(frame.contentWindow!));
    frame.remove();
    return Object.getOwnPropertyNames(window).filter((k) => !builtins.has(k));
  })).toEqual(['api']);
});

test('cấu hình cửa sổ giữ isolation và sandbox', async () => {
  await app.firstWindow();   // electron.launch() có thể trả về trước khi main tạo cửa sổ
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    // getLastWebPreferences() có ở runtime nhưng không có trong electron.d.ts
    const wc = BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): Electron.WebPreferences | null };
    const p = wc.getLastWebPreferences();
    return { contextIsolation: p?.contextIsolation, sandbox: p?.sandbox, nodeIntegration: p?.nodeIntegration };
  });
  expect(prefs).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false });
});

test('không điều hướng ra ngoài, không mở cửa sổ mới', async () => {
  const win = await app.firstWindow();
  await win.evaluate(() => { window.location.href = 'https://example.com/'; });
  // Điều hướng bị will-navigate huỷ thì Playwright không thấy nó kết thúc: sau bước này đừng dùng locator/expect(locator)
  await win.waitForTimeout(1000);
  expect(win.url()).toBe('app://bundle/index.html');
  expect(await win.evaluate(() => window.open('https://example.com/'))).toBeNull();
  expect(app.windows()).toHaveLength(1);
});

test('scheme app:// không trả file ngoài thư mục giao diện', async () => {
  const win = await app.firstWindow();
  const status = await win.evaluate(async () => (await fetch('app://bundle/..%2fmain.js')).status);
  expect(status).toBe(404);
});
