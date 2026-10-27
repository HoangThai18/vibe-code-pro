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
{{src/lib/seo.ts}}
```

The root layout sets only `metadataBase: new URL(SITE_URL)` (relative URLs become absolute) and ``title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` }``. `/` and `/en` both pass `languages: languagesOf('/')`. Locale routing and per-locale formatting: `references/i18n.md`. The app layout (`src/app/t/[tenantId]/layout.tsx`) and `/login` set `robots: NOINDEX` in their `metadata`.

### 3.2 The spa page

`PublicSpa` holds only what the spa published (name, about, public phone, address, hours, price range, services, `updatedAt`). Client component props are serialized into the HTML: when the repository returned the whole row, the test found the owner's phone in the page. A real repository resolves the slug via the read-only `tenant_domains` table, then reads the profile inside `withTenant` (the `vibe-backend` skill, `references/postgres-rls.md` sections 3–4); old slugs stay in `tenant_domains` and redirect.

```tsx
{{src/app/[spaSlug]/page.tsx}}
```

### 3.3 Structured data

```tsx
{{src/lib/json-ld.tsx}}
```

`schema-dts` types it; `DaySpa` is a `LocalBusiness` subtype. Check one spa page in Google's Rich Results Test.

### 3.4 Share image

```tsx
{{src/lib/og-image.tsx}}
```

`src/app/[spaSlug]/opengraph-image.tsx` exports `size`, `contentType`, `alt`, calls `notFound()` unless the spa is published, and returns `ogImage(spa.name, district)`. Next's default font (Geist) also rendered Vietnamese; a brand font without Vietnamese glyphs makes `next/og` fetch them from fonts.googleapis.com on every render, and offline they came out as boxes. Formats: `.ttf`, `.otf`, `.woff`.

### 3.5 Sitemaps and robots.txt

`src/app/sitemap.ts` (`/sitemap.xml`) lists the marketing pages; spa pages are split into files:

```ts
{{src/app/spas/sitemap.ts}}
```

```ts
{{src/app/robots.ts}}
```

### 3.6 Staging and previews

```ts
{{src/proxy.ts}}
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

`test/server.ts` starts the build as production and as staging; `page()` fetches with `redirect: 'manual'`; `seoOf()` reads title, meta, link and JSON-LD tags by regex; `visibleHtml()` drops `<script>` (with the RSC payload) and React's `<!-- -->`. No browser: nothing here may need JavaScript.

```ts
{{test/seo.test.ts}}
```

`test/seo-extra.test.ts` covers robots.txt, sitemaps, private data and share images. `test/og-font.test.ts` stubs `fetch`, renders `ogImage('Đặt Lịch Spa Hoa Mai', ...)` and asserts no request. In CI, after the build (the `vibe-ship` skill, `references/ci-cd.md`):

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
