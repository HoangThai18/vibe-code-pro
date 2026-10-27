# Next.js Server Actions and cached data: tenant safety

A Server Action is a public POST endpoint, and a `'use cache'` entry is shared by every user. Both need the tenant handled on the server, every time. Code ran on Next.js 16.4 (App Router, `cacheComponents: true`), React 19.3, zod 4.6 and PostgreSQL 16 (FORCE RLS); the tests run `next build` + `next start` and post to the action the way any HTTP client can.

## Contents
1. Rules
2. Example: rename a customer
3. Tests

## 1. Rules

| Risk | Rule |
|---|---|
| Anyone can POST to an action, with any arguments, without going through your UI | First line of every action: session, membership in that tenant, permission (`checkAccess`). A check in the page or layout does not cover the action |
| Arguments, bound ones included (`action.bind(null, tenantId)`), are client data | Validate with zod (`z.strictObject`: an extra `tenantId` field is rejected, not ignored); write through `withTenant` so RLS limits the rows |
| Return values are serialized to the client | Return `{ ok, code }` or the fields the UI shows, never database rows |
| A `'use cache'` result is shared across users and requests | The tenant is an argument (arguments and captured variables form the key). No `cookies()`/`headers()` inside: Next.js throws, sometimes only at request time. No access check inside: call it after `checkAccess` |
| A cached function is itself a server function | Never import it into a Client Component: a file-level `'use cache'` export can then be called from the browser with any tenant id. Posted directly, the function-level one below ran with another tenant's id and returned its customers (tested); its id was in no page or client chunk because no client code imports it |
| `unstable_cache` (replaced by `'use cache'` in Next.js 16) | Its key is the arguments plus `keyParts`; variables from the enclosing scope are not in it. A tenant id taken from a closure served spa A's list to spa B (tested): pass the tenant as an argument |
| One tag for all tenants | Tag per tenant (`tenant:<id>:customers`). In an action, `updateTag` (the user sees the change in the same response); from a route handler or webhook, `revalidateTag(tag, 'max')`, or `{ expire: 0 }` to expire at once |

Per-request `QueryClient` and stores on the server: `references/state-management.md` section 7. Membership and roles: the `vibe-backend` skill (`references/postgres-rls.md` section 4, `references/auth.md` section 4).

## 2. Example: rename a customer

`withTenant` and `withMember` come from the `vibe-backend` skill (`references/postgres-rls.md` section 4), `can` and the roles from the same skill (`references/auth.md` section 4); `pool` connects as the app role; `getSessionUserId` verifies the signed session cookie with your auth library.

```ts
{{src/lib/access.ts}}
```

```ts
{{src/app/t/[tenantId]/customers/data.ts}}
```

```ts
{{src/app/t/[tenantId]/customers/actions.ts}}
```

```tsx
{{src/app/t/[tenantId]/customers/page.tsx}}
```

- With `cacheComponents`, a page that reads cookies or params needs a `<Suspense>` boundary (here `loading.tsx`), or `next build` fails. The page then streams: `notFound()` arrives as status 200 with the not-found UI and `noindex`. Fine for app pages; public pages: `references/seo.md` section 2.
- `next.config.ts`: `{ cacheComponents: true, partialPrefetching: true }` (Next.js 16.4 warns when `partialPrefetching` is unset).
- Next.js rejects an action whose `Origin` differs from the host (CSRF); behind a proxy or CDN on another domain, list it in `serverActions.allowedOrigins`.

## 3. Tests

`node --import tsx --test --test-concurrency=1 test/*.test.ts` after `next build` (4 tests). The test reads action ids from `.next/server/server-reference-manifest.json` and posts `JSON.stringify(args)` with headers `next-action`, `origin` (the CSRF check) and the session cookie. Removing any of these made a test fail: the action's access check, the page's access check, `z.strictObject`, the per-tenant tag, the tenant as a cache argument.

| Area | Asserts |
|---|---|
| Cache | spa A's and spa B's lists each hold only their own customers; a second request is served from the cache; A's user on B's path and a request without session get the not-found page, no data |
| Action | as A's user: B's tenant id → `not_found`; B's customer through A → `not_found`; empty name and an extra `tenantId` field → `invalid_input`; no session → `unauthenticated`; both rows unchanged in the database |
| Invalidation | renaming in A returns the re-rendered page with the new name; B's cache entry keeps its timestamp |
| Exposure | the action id is in the page (by design); the cached function's id is in no page or client chunk; posted directly with B's id it returns B's customers |
