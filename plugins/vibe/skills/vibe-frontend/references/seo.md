# SEO for public pages: index the marketing and spa pages, never the app

Get the landing page, pricing, blog and each published spa's booking page `/{spaSlug}` indexed; keep the app, auth pages, staging and previews out. The code ran on Next.js 16.4 (App Router), React 19.3, TypeScript 7.0; the tests fetch `next build` + `next start` output, no browser. Removing a safeguard made a test fail: `<` escaping in JSON-LD, per-page canonical, public-only fields, no `loading.tsx` on the spa route, a font with Vietnamese glyphs.

**Right-size it.** A landing page alone: per-page title, description and canonical (section 3.1), `robots.ts`, `sitemap.ts`, noindex on staging. Add JSON-LD, share images, sitemap splitting and hreflang with spa pages, a second language, or 50,000+ URLs. Keyword research and content: use a dedicated SEO tool or skill.

## Contents
1. What is indexed
2. Rendering: content and status code in the first response
3. Example: the spa app in Next.js
4. Rules
5. Tests
6. Operations

## 1. What is indexed

| URL | Indexed | How |
|---|---|---|
| `/`, `/pricing`, `/blog/...`, `/en/...` | Yes | Static HTML, own canonical, in the sitemap |
| `/{spaSlug}`, published spa | Yes | Rendered per request, JSON-LD, in the sitemap |
| `/{spaSlug}`: draft, deleted, unknown | No | 404 |
| Old slug, other letter case | No | 308 to the current slug |
| `/login`, `/signup`, `/t/{tenantId}/...`, `/app/...` | No | `noindex` metadata; **not** blocked in robots.txt |
| Staging, previews | No | `X-Robots-Tag: noindex` on every response, decided at runtime |
| App on its own host (`app.example.vn`) | No | `X-Robots-Tag: noindex` on the whole host |

robots.txt does not remove pages from the index: a blocked page's `noindex` is never seen, and the URL can still appear in results via links. Use robots.txt only to limit crawl load.

## 2. Rendering: content and status code in the first response

- Landing, pricing, blog: static (Next's default).
- Spa page: per request, so 404 and 308 follow the database. If you cache it, call `revalidatePath` for the old and new paths on publish, unpublish and rename.
- Check with `curl`, not a browser: text loaded in `useEffect` is not in the first response.

**No `loading.tsx` or `<Suspense>` above a lookup that can 404 or redirect**: streaming sends status 200 first. With a `loading.tsx` in `[spaSlug]`, a missing spa returned 200 + `<meta name="robots" content="noindex">` (soft 404), an old slug 200 + `<meta http-equiv="refresh">` instead of 308, and `<title>` and canonical moved into `<body>`. Without it, status codes were real and metadata was in `<head>` for curl, Googlebot, `facebookexternalhit` and an unlisted user agent, even with a 400 ms lookup. Use `<Suspense>` only below the lookup (availability, reviews).

## 3. Example: the spa app in Next.js

### 3.1 Metadata: one helper, nothing inheritable in a layout

Next merges metadata shallowly: a page inherits the layout's `alternates` and `openGraph` unless it sets its own. A canonical in the root layout made every page point to the home page.

```ts
// src/lib/seo.ts — builds the metadata of every public page
import type { Metadata } from 'next';

const siteUrl = process.env.SITE_URL;               // the production origin, in every environment
if (!siteUrl && process.env.NODE_ENV === 'production') throw new Error('SITE_URL is required');
export const SITE_URL = siteUrl ?? 'http://localhost:3000';
export const SITE_NAME = 'Đặt Lịch Spa';
export const NOINDEX: Metadata['robots'] = { index: false, follow: false };

// Vietnamese has no prefix, English lives under /en
export function languagesOf(viPath: string) {
  return { vi: viPath, en: viPath === '/' ? '/en' : `/en${viPath}`, 'x-default': viPath };
}

interface PageSeo {
  path: string;                         // this page's own URL, e.g. '/pricing'
  title: string;
  description: string;
  locale?: 'vi_VN' | 'en_US';
  languages?: ReturnType<typeof languagesOf>;
  ownOgImage?: boolean;                 // this page's folder has an opengraph-image.tsx
}

export function pageMetadata({ path, title, description, locale = 'vi_VN', languages, ownOgImage }: PageSeo): Metadata {
  // A page's openGraph replaces the parent's, image included. A folder's own
  // opengraph-image.tsx is used only when `images` is absent.
  const images = ownOgImage ? {} : { images: '/opengraph-image' };
  return {
    title,
    description,
    alternates: { canonical: path, languages },
    openGraph: { type: 'website', siteName: SITE_NAME, url: path, title, description, locale, ...images },
    twitter: { card: 'summary_large_image', title, description, ...images },
  };
}
```

The root layout sets only `metadataBase: new URL(SITE_URL)` (relative URLs become absolute) and ``title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` }``. `/` and `/en` both pass `languages: languagesOf('/')`. Locale routing and per-locale formatting: `references/i18n.md`. The app layout (`src/app/t/[tenantId]/layout.tsx`) and `/login` set `robots: NOINDEX` in their `metadata`.

### 3.2 The spa page

`PublicSpa` holds only what the spa published (name, about, public phone, address, hours, price range, services priced as `Money`, `updatedAt`); prices go through `formatMoney` (`references/i18n.md` section 2). Client component props are serialized into the HTML: when the repository returned the whole row, the test found the owner's phone in the page. A real repository resolves the slug via the read-only `tenant_domains` table, then reads the profile inside `withTenant` (the `vibe-backend` skill, `references/postgres-rls.md` sections 3–4); old slugs stay in `tenant_domains` and redirect.

```tsx
// src/app/[spaSlug]/page.tsx — a spa's public booking page, rendered on the server per request
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { formatMoney } from '@/i18n/format';
import { JsonLd, spaJsonLd } from '@/lib/json-ld';
import type { Day } from '@/lib/public-spa';
import { findPublicSpa } from '@/lib/spa-repo';
import { pageMetadata } from '@/lib/seo';
import { BookingForm } from './booking-form';

type Props = { params: Promise<{ spaSlug: string }> };

// One lookup for metadata and page. Nothing streams before it (no loading.tsx or <Suspense> above),
// so 404 and 308 are real status codes.
const loadSpa = cache(async (slug: string) => {
  const found = await findPublicSpa(slug);
  if (found.kind === 'moved') permanentRedirect(`/${found.slug}`);   // 308
  if (found.kind === 'missing') notFound();                         // 404, also for drafts and deleted spas
  return found.spa;
});

export async function generateMetadata({ params }: Props) {
  const spa = await loadSpa((await params).spaSlug);
  return pageMetadata({
    path: `/${spa.slug}`,
    title: `${spa.name}: đặt lịch online`,
    description: `${spa.about} ${spa.address.street}, ${spa.address.district}.`,
    ownOgImage: true,
  });
}

const dayVi: Record<Day, string> = { Monday: 'T2', Tuesday: 'T3', Wednesday: 'T4', Thursday: 'T5', Friday: 'T6', Saturday: 'T7', Sunday: 'CN' };

export default async function SpaPage({ params }: Props) {
  const spa = await loadSpa((await params).spaSlug);
  return (
    <main>
      <JsonLd data={spaJsonLd(spa)} />
      <h1>{spa.name}</h1>
      <p>{spa.about}</p>
      {/* JSON-LD may state only what the page shows */}
      <address>
        {spa.address.street}, {spa.address.district}, {spa.address.city} · <a href={`tel:+84${spa.phone.slice(1)}`}>{spa.phone}</a>
      </address>
      <ul>
        {spa.hours.map((h) => (
          <li key={h.days.join()}>{h.days.map((d) => dayVi[d]).join(', ')}: {h.opens}–{h.closes}</li>
        ))}
      </ul>
      <p>Giá: {spa.priceRange}</p>
      <ul>
        {spa.services.map((s) => (
          <li key={s.name}>{s.name}: {formatMoney(s.price, 'vi')}</li>
        ))}
      </ul>
      <BookingForm spa={spa} />
    </main>
  );
}
```

### 3.3 Structured data

```tsx
// src/lib/json-ld.tsx
import type { DaySpa, WithContext } from 'schema-dts';
import type { PublicSpa } from './public-spa';
import { SITE_URL } from './seo';

export function spaJsonLd(spa: PublicSpa): WithContext<DaySpa> {
  const url = `${SITE_URL}/${spa.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'DaySpa',
    '@id': url,
    name: spa.name,
    url,
    description: spa.about,
    telephone: `+84${spa.phone.slice(1)}`,      // stored as 0912345678
    priceRange: spa.priceRange,
    address: {
      '@type': 'PostalAddress',
      streetAddress: spa.address.street,
      addressLocality: spa.address.district,
      addressRegion: spa.address.city,
      addressCountry: 'VN',
    },
    openingHoursSpecification: spa.hours.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: h.days,
      opens: h.opens,
      closes: h.closes,
    })),
  };
}

// JSON.stringify leaves "<" as is: a spa name containing "</script>" would close the tag and run what follows
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
```

`schema-dts` types it; `DaySpa` is a `LocalBusiness` subtype. Check one spa page in Google's Rich Results Test.

### 3.4 Share image

```tsx
// src/lib/og-image.tsx — 1200x630 share image
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

export const ogSize = { width: 1200, height: 630 };
// Has Vietnamese glyphs; read from the repo once per process, no network
const font = readFile(join(process.cwd(), 'assets/Inter-Bold.otf'));

export async function ogImage(title: string, subtitle: string) {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: '100%', height: '100%', padding: 80, background: '#fff7f0', color: '#3b2416', fontFamily: 'Inter' }}>
        <div style={{ fontSize: 72 }}>{title}</div>
        <div style={{ fontSize: 40, marginTop: 24 }}>{subtitle}</div>
      </div>
    ),
    { ...ogSize, fonts: [{ name: 'Inter', data: await font, weight: 700, style: 'normal' }] },
  );
}
```

`src/app/[spaSlug]/opengraph-image.tsx` exports `size`, `contentType`, `alt`, calls `notFound()` unless the spa is published, and returns `ogImage(spa.name, district)`. Next's default font (Geist) also rendered Vietnamese; a brand font without Vietnamese glyphs makes `next/og` fetch them from fonts.googleapis.com on every render, and offline they came out as boxes. Formats: `.ttf`, `.otf`, `.woff`.

### 3.5 Sitemaps and robots.txt

`src/app/sitemap.ts` (`/sitemap.xml`) lists the marketing pages; spa pages are split into files:

```ts
// src/app/spas/sitemap.ts — /spas/sitemap/0.xml, /spas/sitemap/1.xml...: published spa pages
import type { MetadataRoute } from 'next';
import { countPublishedSpas, listPublishedSpas } from '@/lib/spa-repo';
import { SITE_URL } from '@/lib/seo';

const PER_FILE = 50_000;                            // per-file limit (also 50 MB uncompressed)
export const revalidate = 3600;                     // regenerate at most hourly

export async function generateSitemaps() {
  const files = Math.max(1, Math.ceil((await countPublishedSpas()) / PER_FILE));
  return Array.from({ length: files }, (_, id) => ({ id }));
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const id = Number(await props.id);               // Next 16: a promise of a string
  const spas = await listPublishedSpas(id * PER_FILE, PER_FILE);   // ordered by slug
  return spas.map((s) => ({ url: `${SITE_URL}/${s.slug}`, lastModified: s.updatedAt }));
}
```

```ts
// src/app/robots.ts — /robots.txt
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';
import { generateSitemaps } from './spas/sitemap';

export const revalidate = 3600;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const spaSitemaps = (await generateSitemaps()).map(({ id }) => `${SITE_URL}/spas/sitemap/${id}.xml`);
  return {
    // No Disallow for /login or /t/: a crawler that may not fetch a page never sees its noindex
    rules: { userAgent: '*', allow: '/' },
    sitemap: [`${SITE_URL}/sitemap.xml`, ...spaSitemaps],       // generateSitemaps writes no index file
  };
}
```

### 3.6 Staging and previews

```ts
// src/proxy.ts — staging and previews: noindex on every response
import { NextResponse } from 'next/server';

// Read per request, so one build can go from staging to production.
// Fail closed: anything not explicitly production is noindex.
export function proxy() {
  const response = NextResponse.next();
  if (process.env.APP_ENV !== 'production') response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
```

Not in `next.config.ts` `headers()`, which is evaluated at build: a build made with `APP_ENV=staging`, started as production, still sent `noindex`. A password on staging is better still. Vercel adds `X-Robots-Tag: noindex` to preview deployments, except on a custom domain assigned to a non-production branch.

## 4. Rules

1. Public content is in the first HTML response; client components add interaction only.
2. Unique title and description; one absolute canonical pointing to the page itself, set through the helper. The build fails without `SITE_URL`.
3. noindex, not robots.txt, for the app, auth pages and staging.
4. Draft, deleted, unknown spa: `notFound()`. Old slug, other case: `permanentRedirect()` (308). Never a 200 "spa không tồn tại" page.
5. Reserve route names as slugs (`pricing`, `blog`, `en`, `login`, `t`, `app`, `api`, `spas`): static routes win, so such a spa page is unreachable. Never give an old slug to another spa.
6. Only `PublicSpa` fields in metadata, JSON-LD, share images and client props; the image route 404s for unpublished spas.
7. JSON-LD escapes `<` and states only what the page shows.
8. One URL per language; every version lists all versions, itself included, plus `x-default`. Never switch language at one URL by `Accept-Language`: Googlebot usually crawls without it.
9. Sitemaps hold only indexable canonical URLs, at most 50,000 URLs and 50 MB uncompressed per file; `lastModified` is the real change time.
10. Core Web Vitals: the `vibe-ship` skill (`references/performance.md` section 5).

## 5. Tests

`node --import tsx --test --test-concurrency=1 test/*.test.ts` after `next build` (11 tests). `test/server.ts` starts the build twice, as production and as staging (`APP_ENV`); requests use `redirect: 'manual'` and read `<title>`, meta, link and JSON-LD tags by regex from the HTML with `<script>` and React's `<!-- -->` removed. No browser: nothing here may need JavaScript.

| Area | Asserts |
|---|---|
| Public pages (`/`, `/en`, `/pricing`, `/spa-hoa-mai`) | 200; text in the HTML (`'Massage body 90 phút: 450.000\u00a0₫'`); canonical and `og:url` = the page itself; absolute `og:image`; no `robots` meta, no `X-Robots-Tag`; titles and descriptions all different |
| hreflang | `/` and `/en` both list `vi`, `en`, `x-default` (→ `/`) |
| noindex | `/login`, `/t/{id}/appointments`: `noindex, nofollow` meta; staging build: `X-Robots-Tag` on `/`, a spa page, `/sitemap.xml`; 404 pages carry `noindex` |
| Spa status | draft, deleted, unknown: 404; old slug, `/Spa-Hoa-Mai`: 308 → `/spa-hoa-mai` |
| JSON-LD | parses; `DaySpa`, `telephone: '+84912345678'`, 2 opening-hours entries; phone, hours, price range visible on the page; name `Sen Vàng </script><script>alert(1)</script>` comes back intact, no raw `<script>alert(1)</script>` in the HTML |
| robots.txt, sitemaps | no `Disallow` on `/login`, `/t/`; lists the 3 sitemaps; 50,002 spa URLs split ≤ 50,000 per file, no duplicates, no draft/deleted/old slug; `lastmod` = `updatedAt` |
| Private data | owner phone, customer count, tenant id not in the spa page |
| Share images | spa page uses its own `opengraph-image` (PNG, 200); 404 for an unpublished spa; `ogImage('Đặt Lịch Spa Hoa Mai', ...)` renders with `fetch` stubbed and makes no request |

In CI, after the build (the `vibe-ship` skill, `references/ci-cd.md`):

```text
SITE_URL=https://datlich.example.vn npx next build
SITE_URL=https://datlich.example.vn node --import tsx --test --test-concurrency=1 test/*.test.ts
```

## 6. Operations

- Google Search Console (manual): verify a Domain property, submit the sitemaps. After releases touching public pages, run URL Inspection "Test live URL" on one spa page (rendered HTML, Google-selected canonical, indexing allowed). In Page indexing, "Excluded by 'noindex' tag" should hold only app and auth URLs; fix every "Soft 404".
- Before launch, check a spa link's preview in Zalo and Facebook (Facebook's Sharing Debugger refreshes its cache).

## Done when

- [ ] `curl` on each public page shows its text, own canonical, unique title and description.
- [ ] App, auth pages and staging are noindex; robots.txt blocks none of them.
- [ ] Draft, deleted and unknown spas return 404; old slugs 308.
- [ ] JSON-LD parses, survives a name containing `</script>`, states only visible facts.
- [ ] Sitemaps list only published spas, ≤ 50,000 URLs per file, all listed in robots.txt.
- [ ] Share images render Vietnamese offline.
- [ ] Section 5 tests run in CI.

Sources: Google Search Central: [noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing), [robots.txt](https://developers.google.com/search/docs/crawling-indexing/robots/intro), [sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [localized versions](https://developers.google.com/search/docs/specialty/international/localized-versions), [locale-adaptive pages](https://developers.google.com/search/docs/specialty/international/locale-adaptive-pages), [structured data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies); [Vercel previews](https://vercel.com/guides/are-vercel-preview-deployment-indexed-by-search-engines); Next.js 16.4 docs in `node_modules/next/dist/docs`.
