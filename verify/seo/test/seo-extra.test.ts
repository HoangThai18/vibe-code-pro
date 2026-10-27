// test/seo-extra.test.ts — robots.txt, sitemaps, private data, share images
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { locs } from './html';
import { get, page, start, stopAll, url } from './server';

let prod = '';
before(async () => {
  prod = await start(3103, 'production');
});
after(stopAll);

test('robots.txt blocks nothing that relies on noindex, and lists every sitemap', async () => {
  const txt = await (await get(prod, '/robots.txt')).text();
  assert.doesNotMatch(txt, /Disallow: \/(login|t\/|$)/m);
  const sitemaps = [...txt.matchAll(/^Sitemap: (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(sitemaps, [url('/sitemap.xml'), url('/spas/sitemap/0.xml'), url('/spas/sitemap/1.xml')]);
});

test('sitemaps: published spas only, at most 50,000 URLs per file, with lastmod', async () => {
  const marketing = await (await get(prod, '/sitemap.xml')).text();
  assert.deepEqual(locs(marketing), [url('/'), url('/en'), url('/pricing')]);
  const files = await Promise.all([0, 1].map(async (id) => (await get(prod, `/spas/sitemap/${id}.xml`)).text()));
  const spaUrls = files.flatMap(locs);
  for (const xml of files) assert.ok(locs(xml).length <= 50_000);
  assert.equal(spaUrls.length, 50_002);
  assert.equal(new Set(spaUrls).size, spaUrls.length, 'no URL in two files');
  assert.ok(spaUrls.includes(url('/spa-hoa-mai')));
  for (const hidden of ['/spa-nhap', '/spa-da-dong', '/hoa-mai-spa']) assert.ok(!spaUrls.includes(url(hidden)), hidden);
  assert.match(files.join(''), new RegExp(`<loc>${url('/spa-hoa-mai')}</loc>\\s*<lastmod>2026-10-20T03:00:00.000Z</lastmod>`));
});

test('404 pages carry noindex too', async () => {
  for (const path of ['/spa-nhap', '/khong-co-spa-nay']) {
    const { res, seo } = await page(prod, path);
    assert.equal(res.status, 404);
    assert.match(seo.robots ?? '', /noindex/);
  }
});

test('no private tenant data on the public page', async () => {
  const { html } = await page(prod, '/spa-hoa-mai');
  for (const secret of ['0987654321', '1834', 'aaaaaaaa-aaaa', 'ownerPhone', 'customerCount']) {
    assert.ok(!html.includes(secret), secret);
  }
});

test('OG image: the spa own PNG; 404 for an unpublished spa', async () => {
  const og = new URL((await page(prod, '/spa-hoa-mai')).seo.ogImage!);
  assert.equal(og.pathname, '/spa-hoa-mai/opengraph-image');      // not the site default
  const image = await get(prod, og.pathname + og.search);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal((await get(prod, '/spa-nhap/opengraph-image')).status, 404);
  assert.equal(new URL((await page(prod, '/pricing')).seo.ogImage!).pathname, '/opengraph-image');
});
