// Not in the docs: app-data.md modules inside real Electron (app.getVersion(), platform, safeStorage), in-app navigation
import { _electron as electron, expect, test } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Mods = {
  apiClient: { createApiClient: (deps: object) => (path: string) => Promise<unknown> };
  sessionStore: { saveRefreshToken: (t: string) => Promise<void>; loadRefreshToken: () => Promise<string | null> };
};
type G = { modules: Mods; ready?: boolean; updates?: number; sessionFileExists: () => boolean };
// evaluate() serializes the function: reach main-process globals through globalThis inside it

test('api client: app.getVersion() and the mapped platform on every request, 426 opens the update flow', async () => {
  const seen: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    res.writeHead(req.url === '/v1/old' ? 426 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/v1/old' ? { error: { code: 'app_update_required' } } : { data: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const app = await electron.launch({ args: ['tests/fixtures/modules-app'] });
  try {
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as G).ready === true)).toBe(true);
    const result = await app.evaluate(async (_electron, url) => {
      const g = globalThis as unknown as G;
      const api = g.modules.apiClient.createApiClient({
        baseUrl: url, getAccessToken: () => null, refreshSession: async () => 'signed-out',
        onUpdateRequired: () => { g.updates = (g.updates ?? 0) + 1; },
      });
      const ok = await api('/v1/t/t1/customers');
      const err = await api('/v1/old').catch((e: { status: number; code: string }) => ({ status: e.status, code: e.code }));
      return { ok, err, updates: g.updates };
    }, baseUrl);
    expect(result).toEqual({ ok: { data: [] }, err: { status: 426, code: 'app_update_required' }, updates: 1 });
    expect(seen.map((h) => [h['x-app-version'], h['x-app-platform']])).toEqual([['1.4.2', 'linux'], ['1.4.2', 'linux']]);
  } finally {
    await app.close();
    server.close();
  }
});

test('session store: without an OS keyring nothing is written; with one the token round-trips', async () => {
  const app = await electron.launch({ args: ['tests/fixtures/modules-app'] });
  try {
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as G).ready === true)).toBe(true);
    const r = await app.evaluate(async ({ safeStorage }) => {
      const g = globalThis as unknown as G;
      const saved = await g.modules.sessionStore.saveRefreshToken('r1').then(() => 'ok', (e: Error) => e.message);
      return { backend: safeStorage.getSelectedStorageBackend(), saved, loaded: await g.modules.sessionStore.loadRefreshToken(), file: g.sessionFileExists() };
    });
    if (r.backend === 'basic_text') {
      expect(r).toEqual({ backend: 'basic_text', saved: 'Không có keyring (libsecret/kwallet): không lưu token xuống đĩa', loaded: null, file: false });
    } else {
      expect(r).toMatchObject({ saved: 'ok', loaded: 'r1', file: true });
    }
  } finally {
    await app.close();
  }
});

test('navigation inside the app is still allowed', async () => {
  const app = await electron.launch({ args: ['.'] });
  try {
    const win = await app.firstWindow();
    await expect(win.getByRole('heading', { name: 'Khách hàng' })).toBeVisible();
    await win.evaluate(() => { window.location.href = 'app://bundle/index.html?page=2'; });
    await expect(win).toHaveURL('app://bundle/index.html?page=2');
    await expect(win.getByRole('heading', { name: 'Khách hàng' })).toBeVisible();
  } finally {
    await app.close();
  }
});
