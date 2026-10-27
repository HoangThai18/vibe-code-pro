import { defineConfig } from 'vitest/config';

// Test files share one database: run them one at a time
export default defineConfig({
  test: { globalSetup: ['test/support/global-setup.ts'], fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000 },
});
