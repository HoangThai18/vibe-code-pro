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
