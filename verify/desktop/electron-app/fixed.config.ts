import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests/fixed', workers: 1, timeout: 30_000 });
