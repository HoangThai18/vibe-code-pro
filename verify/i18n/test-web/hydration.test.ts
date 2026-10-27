// Run after `next build`: node --import tsx --test test-web/hydration.test.ts
// Starts `next start` with the server in UTC, opens the pages in Chromium set to other zones, collects hydration errors.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { after, before, test } from 'node:test';
import { chromium, type Browser } from 'playwright-core';

const PORT = 3217;
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
let server: ChildProcess;
let browser: Browser;

before(async () => {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {
    env: { ...process.env, TZ: 'UTC', NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.launch({ executablePath: CHROME });
});
after(async () => {
  await browser?.close();
  server?.kill();
});

async function open(path: string, opts: { timezoneId: string; locale: string; cookie?: string }) {
  const context = await browser.newContext({ timezoneId: opts.timezoneId, locale: opts.locale });
  if (opts.cookie) await context.addCookies([{ name: 'demo_user_locale', value: opts.cookie, url: BASE }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const html = await (await page.request.get(BASE + path, { headers: { 'accept-language': opts.locale } })).text();
  await page.goto(BASE + path);
  await page.waitForLoadState('networkidle');
  const text = await page.locator('#at').textContent();
  const result = { html, text, errors, lang: await page.locator('html').getAttribute('lang'), count: await page.locator('#count').textContent().catch(() => null) };
  await context.close();
  return result;
}

test('explicit tenant zone: server (UTC) and browser (New York, Hanoi) render the same, no hydration error', async () => {
  for (const timezoneId of ['America/New_York', 'Asia/Ho_Chi_Minh']) {
    const r = await open('/', { timezoneId, locale: 'en-US' });
    assert.match(r.html, /15:30 24\/10\/2026/);
    assert.equal(r.text, '15:30 24/10/2026');
    assert.equal(r.lang, 'vi');                       // tenant default beats the browser's Accept-Language
    assert.equal(r.count, '1.250 khách');
    assert.deepEqual(r.errors, [], timezoneId);
  }
});

test('user preference en: English messages and format, still the tenant zone', async () => {
  const r = await open('/', { timezoneId: 'Europe/London', locale: 'vi-VN', cookie: 'en' });
  assert.equal(r.lang, 'en');
  assert.equal(r.count, '1,250 customers');
  assert.equal(r.text, 'Oct 24, 2026, 3:30 PM');
  assert.deepEqual(r.errors, []);
});

test('toLocaleString without timeZone: server says 08:30, a browser in Vietnam says 15:30, React reports a mismatch', async () => {
  const r = await open('/naive', { timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN' });
  assert.match(r.html, /08:30:00 24\/10\/2026/);
  assert.equal(r.text, '15:30:00 24/10/2026');
  assert.ok(r.errors.some((e) => /418|[Hh]ydrat/.test(e)), r.errors.join('\n'));
});
