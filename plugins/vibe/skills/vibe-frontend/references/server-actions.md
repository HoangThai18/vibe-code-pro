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
// src/lib/access.ts — the first call in every tenant page and Server Action
import { withMember } from '@/db/tenant';            // the vibe-backend skill, references/postgres-rls.md section 4
import { can, type Action, type UserActor } from '@/shared/authz';   // the vibe-backend skill, references/auth.md section 4
import { NotFoundError } from '@/shared/errors';
import { pool } from './db';
import { getSessionUserId } from './session';

export type Denied = { ok: false; code: 'unauthenticated' | 'not_found' | 'forbidden' };
export type Access = { ok: true; actor: UserActor } | Denied;

// Reads the session cookie (request-time data): call it outside 'use cache' functions, never inside
export async function checkAccess(tenantId: unknown, action: Action): Promise<Access> {
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, code: 'unauthenticated' };
  try {
    const actor = await withMember(pool, String(tenantId), userId, async (_db, actor) => actor);
    return can(actor.role, action) ? { ok: true, actor } : { ok: false, code: 'forbidden' };
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, code: 'not_found' };   // not a member, or no such tenant
    throw err;
  }
}
```

```ts
// src/app/t/[tenantId]/customers/data.ts
import { cacheLife, cacheTag } from 'next/cache';
import { withTenant } from '@/db/tenant';
import { pool } from '@/lib/db';

export const customersTag = (tenantId: string) => `tenant:${tenantId}:customers`;

// Shared by every user of the tenant, across requests. The tenant is an argument, so it is part of the cache key;
// the function reads no cookies or headers (Next.js refuses) and checks no access: call it after checkAccess
export async function listCustomers(tenantId: string) {
  'use cache';
  cacheLife('hours');
  cacheTag(customersTag(tenantId));
  const { rows } = await withTenant(pool, tenantId, (db) =>
    db.query<{ id: string; full_name: string }>('SELECT id, full_name FROM customers ORDER BY full_name'));
  return { customers: rows, loadedAt: new Date().toISOString() };
}
```

```ts
// src/app/t/[tenantId]/customers/actions.ts
'use server';
import { updateTag } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db/tenant';
import { checkAccess, type Denied } from '@/lib/access';
import { pool } from '@/lib/db';
import { customersTag } from './data';

const RenameCustomer = z.strictObject({ customerId: z.uuid(), fullName: z.string().trim().min(1).max(200) });

// A Server Action is a public POST endpoint: anyone can call it with any arguments, the bound tenantId included
export async function renameCustomer(tenantId: string, input: unknown): Promise<{ ok: true } | Denied | { ok: false; code: 'invalid_input' }> {
  const access = await checkAccess(tenantId, 'customer.write');   // session, membership, permission: on every call
  if (!access.ok) return access;
  const parsed = RenameCustomer.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  const { rowCount } = await withTenant(pool, tenantId, (db) =>
    db.query('UPDATE customers SET full_name = $2 WHERE id = $1', [parsed.data.customerId, parsed.data.fullName]));
  if (rowCount === 0) return { ok: false, code: 'not_found' };   // another tenant's customer: RLS hides it
  updateTag(customersTag(tenantId));   // this tenant's entries only; the response already shows the new name
  return { ok: true };
}
```

```tsx
// src/app/t/[tenantId]/customers/page.tsx
import { notFound } from 'next/navigation';
import { checkAccess } from '@/lib/access';
import { renameCustomer } from './actions';
import { listCustomers } from './data';
import { RenameForm } from './rename-form';

export default async function CustomersPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const access = await checkAccess(tenantId, 'customer.read');   // per request, before any cached read
  if (!access.ok) notFound();
  const { customers, loadedAt } = await listCustomers(tenantId);
  return (
    <main data-loaded-at={loadedAt}>
      <ul>
        {customers.map((c) => (
          <li key={c.id}>
            {c.full_name} <RenameForm action={renameCustomer.bind(null, tenantId)} customerId={c.id} />
          </li>
        ))}
      </ul>
    </main>
  );
}
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
