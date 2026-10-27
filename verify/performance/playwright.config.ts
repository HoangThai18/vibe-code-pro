import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  use: { baseURL: 'http://127.0.0.1:3200', launchOptions: { executablePath: '/opt/pw-browsers/chromium' } },
  webServer: { command: 'node static-server.mjs', url: 'http://127.0.0.1:3200/customers', reuseExistingServer: false },
});
