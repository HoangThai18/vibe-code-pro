import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests/probe', workers: 1, timeout: 60_000 });
