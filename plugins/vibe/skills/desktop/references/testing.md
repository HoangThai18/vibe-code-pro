# Test app desktop

Nguyên tắc như skill `build` (`testing.md`; từ file này: `../../build/references/testing.md`). Renderer là app web: unit và component test như web. Phần riêng của desktop là main process, IPC, cấu hình bảo mật và bản đóng gói.

## Mục lục
1. Chọn mức test
2. E2E Electron bằng Playwright
3. Test cấu hình bảo mật
4. Tauri
5. Chạy trong CI

## 1. Chọn mức test

| Cần kiểm | Mức |
|---|---|
| Logic thuần (tính tiền, parse CSV, đồng bộ) | Unit, tách khỏi Electron/Tauri |
| Renderer: màn hình, form, state | Component test như web, mock `window.api` |
| Main process + preload + renderer chạy cùng nhau, IPC, hộp thoại file | E2E (Playwright cho Electron) |
| Cấu hình bảo mật (không có Node trong renderer, chặn điều hướng, chặn path traversal) | E2E, chạy ở mọi PR (mục 3) |
| Cài đặt, ký số, tự cập nhật | Thử bản đóng gói trên từng hệ điều hành trước release |

## 2. E2E Electron bằng Playwright

Playwright điều khiển được app Electron (API `_electron`, đang ở trạng thái thử nghiệm): mở app, lấy cửa sổ, chạy code trong main process.

```ts
// tests/e2e/app.spec.ts
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let app: ElectronApplication;

test.beforeEach(async () => {
  app = await electron.launch({ args: ['.'] });   // chạy app từ thư mục gốc (package.json "main")
});

test.afterEach(async () => {
  await app.close();
});

test('nhập CSV qua hộp thoại chọn file của main process', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-'));
  const csv = path.join(dir, 'khach.csv');
  await fs.writeFile(csv, 'name\nNguyễn Thị Lan\nTrần Văn Minh\n');
  // Hộp thoại của hệ điều hành không bấm được bằng Playwright: thay kết quả của nó trong main process
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, csv);

  const win = await app.firstWindow();
  await win.getByRole('button', { name: 'Nhập CSV' }).click();
  await expect(win.getByRole('status')).toHaveText('Đã đọc 2 khách');
});
```

## 3. Test cấu hình bảo mật

Cấu hình bảo mật dễ bị đổi nhầm (một dòng `nodeIntegration: true` khi debug). Khoá lại bằng test chạy ở mọi PR:

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
```

## 4. Tauri

- Logic trong command: `cargo test` (tách hàm xử lý khỏi phần gọi hộp thoại, hệ điều hành).
- Renderer: component test như web, giả IPC bằng `mockIPC` của `@tauri-apps/api/mocks`.
- E2E: WebDriver qua `tauri-driver` chạy được trên Linux và Windows; macOS chưa có driver cho WKWebView, nên luồng chính trên macOS thử tay theo checklist.

## 5. Chạy trong CI

- Linux cần màn hình ảo để mở cửa sổ: `xvfb-run -a npx playwright test` (cài gói `xvfb`).
- Ma trận hệ điều hành (`ubuntu-latest`, `windows-latest`, `macos-latest`) cho test và đóng gói; test bảo mật ở mục 3 chạy trên mọi PR.
- Test bản đã đóng gói (không chỉ chạy từ source) ít nhất trước mỗi release: `electron.launch({ executablePath: '<đường dẫn file chạy>' })`.
