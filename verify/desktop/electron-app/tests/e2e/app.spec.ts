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
