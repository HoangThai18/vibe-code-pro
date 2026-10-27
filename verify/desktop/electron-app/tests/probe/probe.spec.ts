import { _electron as electron, expect, test } from '@playwright/test';

test('probe fetch + navigation', async () => {
  const app = await electron.launch({ args: ['.'] });
  const logs: string[] = [];
  app.process().stdout?.on('data', (d) => logs.push('OUT ' + d));
  app.process().stderr?.on('data', (d) => logs.push('ERR ' + d));
  await app.evaluate(({ app: a }) => {
    a.on('web-contents-created', () => {});
  });
  const win = await app.firstWindow();
  await win.waitForLoadState();
  console.log('url', win.url());
  for (const u of ['app://bundle/index.html', 'app://bundle/%2e%2e/main.js', 'app://bundle/nope.js', 'app://bundle/..%2fmain.js', 'app://bundle/%2e%2e%2fmain.js', 'app://bundle/..%2Fpackage.json', 'app://other/index.html']) {
    const r = await win.evaluate(async (url) => {
      try { const res = await fetch(url); return `${res.status} ${(await res.text()).slice(0, 40).replace(/\n/g, ' ')}`; }
      catch (e) { return 'ERR ' + String(e); }
    }, u);
    console.log(u, '=>', r);
  }
  console.log('resolved', await win.evaluate(() => [new URL('app://bundle/%2e%2e/main.js').href, new URL('app://bundle/..%2fmain.js').href]));
  // navigation
  const navEvents = await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0]!.webContents;
    (globalThis as any).__nav = [];
    for (const ev of ['will-navigate', 'did-start-navigation', 'did-fail-load', 'did-finish-load', 'did-navigate', 'did-stop-loading']) {
      wc.on(ev as any, (...a: any[]) => (globalThis as any).__nav.push(ev + ' ' + a.slice(1, 4).map(String).join(' ')));
    }
    return 'ok';
  });
  await win.evaluate(() => { window.location.href = 'https://example.com/'; });
  await new Promise((r) => setTimeout(r, 3000));
  console.log('events', JSON.stringify(await app.evaluate(() => (globalThis as any).__nav), null, 1));
  console.log('url after', win.url());
  console.log('heading count', await win.evaluate(() => document.querySelectorAll('h1').length).catch((e) => 'ERR ' + e));
  console.log('readyState', await win.evaluate(() => document.readyState).catch((e) => 'ERR ' + e));
  const visible = await win.getByRole('heading', { name: 'Khách hàng' }).isVisible({ timeout: 1000 } as any).catch((e: any) => 'ERR ' + e);
  console.log('isVisible', visible);
  console.log(logs.join(''));
  await app.close();
});
