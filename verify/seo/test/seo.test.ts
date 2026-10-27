// test/seo.test.ts — runs against the production build (commands below)
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { visibleHtml } from './html';
import { get, norm, page, start, stopAll, url } from './server';

let prod = '';
let staging = '';
before(async () => {
  [prod, staging] = await Promise.all([start(3101, 'production'), start(3102, 'staging')]);
});
after(stopAll);

test('public pages: text in the HTML, unique title and description, own canonical, indexable', async () => {
  const pages = [
    ['/', 'Phần mềm quản lý và đặt lịch cho spa'],
    ['/en', 'Spa management and online booking'],
    ['/pricing', 'Gói Cơ bản 299.000₫/tháng'],
    ['/spa-hoa-mai', 'Massage body 90 phút: 450.000\u00a0₫'],
  ] as const;
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const [path, text] of pages) {
    const { res, html, seo } = await page(prod, path);
    assert.equal(res.status, 200, path);
    assert.ok(visibleHtml(html).includes(text), `${path}: readable without JavaScript`);
    assert.equal(norm(seo.canonical), url(path), path);
    assert.equal(norm(seo.ogUrl), url(path), path);
    assert.ok(seo.ogImage?.startsWith(url('/')), `${path}: absolute og:image`);
    assert.equal(seo.robots, undefined, path);
    assert.equal(res.headers.get('x-robots-tag'), null, path);
    titles.add(seo.title);
    descriptions.add(seo.description ?? assert.fail(`${path}: no description`));
  }
  assert.equal(titles.size, pages.length);
  assert.equal(descriptions.size, pages.length);
});

test('hreflang: vi, en and x-default, the same set on both versions', async () => {
  for (const path of ['/', '/en']) {
    const { hreflang } = (await page(prod, path)).seo;
    assert.deepEqual(Object.keys(hreflang).sort(), ['en', 'vi', 'x-default'], path);
    assert.equal(norm(hreflang.vi), url('/'));
    assert.equal(norm(hreflang.en), url('/en'));
    assert.equal(norm(hreflang['x-default']), url('/'));
  }
});

test('noindex: app and auth pages; on staging, every response of the same build', async () => {
  for (const path of ['/login', '/t/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/appointments']) {
    assert.equal((await page(prod, path)).seo.robots, 'noindex, nofollow', path);
  }
  for (const path of ['/', '/spa-hoa-mai', '/sitemap.xml']) {
    assert.equal((await get(staging, path)).headers.get('x-robots-tag'), 'noindex, nofollow', path);
  }
});

test('spa status codes: 404 for draft, deleted, unknown; 308 for an old slug or other case', async () => {
  for (const path of ['/spa-nhap', '/spa-da-dong', '/khong-co-spa-nay']) {
    assert.equal((await get(prod, path)).status, 404, path);
  }
  for (const path of ['/hoa-mai-spa', '/Spa-Hoa-Mai']) {
    const res = await get(prod, path);
    assert.equal(res.status, 308, path);
    assert.equal(new URL(res.headers.get('location')!, prod).pathname, '/spa-hoa-mai');
  }
});

test('JSON-LD: parses, states only visible facts, and a name with </script> cannot break out', async () => {
  const { html, seo } = await page(prod, '/spa-hoa-mai');
  const [spa] = seo.jsonLd;
  assert.equal(spa?.['@type'], 'DaySpa');
  assert.equal(spa?.telephone, '+84912345678');
  assert.equal((spa?.openingHoursSpecification as unknown[]).length, 2);
  for (const fact of ['0912345678', '09:00–21:00', String(spa?.priceRange)]) {
    assert.ok(visibleHtml(html).includes(fact), `${fact} is visible`);
  }

  const xss = await page(prod, '/sen-vang');
  assert.ok(!xss.html.includes('<script>alert(1)</script>'));
  assert.equal(xss.seo.jsonLd[0]?.name, 'Sen Vàng </script><script>alert(1)</script>');
});
