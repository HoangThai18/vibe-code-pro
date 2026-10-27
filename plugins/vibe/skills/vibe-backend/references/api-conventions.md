# Default API conventions

A starting point when the project has no conventions yet. If the project has its own, follow them. Once decided, record a summary in `AGENTS.md`.

The zod and OpenAPI templates, the idempotency code and the version middleware ran with Node 22, PostgreSQL 16 (FORCE RLS), zod 4.6, Express 5.

## Contents
1. Naming and structure
2. Responses and errors
3. Pagination, filtering, sorting
4. Data types
5. Auth and tenant
6. Idempotency
7. Contract templates: zod, OpenAPI, MSW
8. Long-lived clients: mobile, desktop apps

## 1. Naming and structure
- Resource-based REST, plural nouns. Tenant resources live under the `/v1/t/{tenantId}` prefix (section 5): `GET /v1/t/{tenantId}/customers`, `GET .../customers/{id}`, `POST .../customers`, `PATCH .../customers/{id}`, `DELETE .../customers/{id}`.
- Non-CRUD actions: `POST .../orders/{id}/cancel`, `POST .../customers/{id}/archive`.
- JSON fields: camelCase (or snake_case; pick one and use it system-wide).
- Version in the path prefix (`/v1`); bump only on breaking changes.

## 2. Responses and errors
- Single resource: `{ "data": { ... } }`
- List: `{ "data": [ ... ], "nextCursor": "..." }` (`nextCursor` is `null` on the last page)
- Error:

```json
{
  "error": {
    "code": "customer_email_taken",
    "message": "Email này đã có trong workspace.",
    "details": { "field": "email" },
    "requestId": "req_01J9Z..."
  }
}
```

| HTTP | When |
|---|---|
| 400 | Bad format / validation failed (`details` lists errors per field) |
| 401 | Not logged in, token expired |
| 403 | Logged in but not allowed to perform this action |
| 404 | Doesn't exist **or belongs to another tenant** (indistinguishable) |
| 409 | Conflict: duplicate unique value, stale version, slot already booked, same `Idempotency-Key` still running |
| 422 | Valid format but breaks a business rule; `Idempotency-Key` reused with another body |
| 429 | Rate limit exceeded (with `Retry-After`) |
| 500 | Server error: generic message, details only in logs (look up by `requestId`) |

## 3. Pagination, filtering, sorting
- Lists that can grow use cursors: `?limit=20&cursor=...` (default 20, max 100). Offset only for small tables that need page jumps.
- The cursor is an opaque string (e.g. base64 of `createdAt,id`); stable sort with `id` as tie-breaker.
- Filtering: `?status=active&createdFrom=2026-01-01T00:00:00Z`. Sorting: `?sort=-createdAt`, accepting only fields on an allowlist.

## 4. Data types
- ID: string (UUID/ULID).
- Time: ISO 8601 UTC (`2026-10-24T08:30:00Z`); FE displays in the user's or tenant's time zone.
- Money: integer in the smallest unit + currency code: `{ "amount": 150000, "currency": "VND" }`. Never float.
- Enum: meaningful strings (`"active"`), not numbers.
- PATCH: an omitted field means unchanged; `null` means clear the value. Document which fields may be `null`.

## 5. Auth and tenant
- Token or session cookie → the server identifies the **user**.
- The tenant is in the **path** (`/v1/t/{tenantId}/...`). On **every** request the server checks the user is a member of that tenant, takes the role from the membership, then sets tenant context for the transaction (`references/postgres-rls.md` section 4). Not a member, or malformed `tenantId` → 404.
- No implicit "current tenant" in the session: switching workspace in the FE is just a URL change, and multiple tabs on different workspaces still work (the `vibe-frontend` skill, `references/state-management.md` section 5). The session should only remember the last-used workspace for the post-login redirect.
- `tenantId` in body/query is ignored: the tenant comes only from the membership-checked path.
- Each endpoint documents its required permission, named `resource.action` (e.g. `customer.write`, `references/auth.md` section 4).

## 6. Idempotency

POSTs that create resources or have side effects (payments, messages, bookings) accept an `Idempotency-Key` header: 8–255 characters, a new UUID per user action, the same one on every retry of it. The server keeps key and response per tenant for 24 hours:

| Case | Response |
|---|---|
| First request | runs; key and response are stored in the same transaction as the write |
| Same key and request, after the first finished | the stored status and body; nothing runs again |
| Same key while the first is still running | `409 idempotency_in_progress`, at once (the client retries later) |
| Same key, another method, path or body | `422 idempotency_key_reused` |
| The first request failed (rolled back) | no key was stored: a retry runs normally |

```sql
CREATE TABLE idempotency_keys (
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  key          text NOT NULL CHECK (length(key) BETWEEN 8 AND 255),
  request_hash bytea NOT NULL,                   -- SHA-256 of method, path and body
  status       smallint NOT NULL,
  response     jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
CREATE INDEX idempotency_keys_created ON idempotency_keys (tenant_id, created_at);
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON idempotency_keys
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
```

```ts
// src/http/idempotency.ts — inside withMember, around the use case that writes
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { HttpError } from '../shared/errors';

export interface Outcome { status: number; body: unknown }

export async function idempotent(
  db: PoolClient, key: string, req: { method: string; path: string; body: unknown },
  run: () => Promise<Outcome>,
): Promise<Outcome & { replayed: boolean }> {
  if (key.length < 8 || key.length > 255) throw new HttpError(400, 'idempotency_key_invalid', 'Idempotency-Key không hợp lệ.');
  const hash = createHash('sha256').update(`${req.method} ${req.path}\n${JSON.stringify(req.body ?? null)}`).digest();
  // Non-blocking: while the first request with this key is still running, a duplicate gets 409 at once
  const { rows: [lock] } = await db.query<{ ok: boolean }>(
    "SELECT pg_try_advisory_xact_lock(hashtextextended(app_current_tenant()::text || ':' || $1, 0)) AS ok", [key]);
  if (!lock!.ok) throw new HttpError(409, 'idempotency_in_progress', 'Yêu cầu này đang được xử lý.');
  const { rows: [prev] } = await db.query<{ request_hash: Buffer; status: number; response: unknown }>(
    'SELECT request_hash, status, response FROM idempotency_keys WHERE key = $1', [key]);
  if (prev) {
    if (!prev.request_hash.equals(hash)) throw new HttpError(422, 'idempotency_key_reused', 'Idempotency-Key đã dùng cho yêu cầu khác.');
    return { status: prev.status, body: prev.response, replayed: true };
  }
  const outcome = await run();
  // Same transaction as the write: both commit or neither does. A failed request leaves no key, so the client can retry.
  await db.query('INSERT INTO idempotency_keys (key, request_hash, status, response) VALUES ($1, $2, $3, $4)',
    [key, hash, outcome.status, JSON.stringify(outcome.body)]);
  return { ...outcome, replayed: false };
}
```

```ts
// src/jobs/purge-idempotency-keys.ts — daily job (references/jobs.md)
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant';

export async function purgeIdempotencyKeys(pool: Pool): Promise<number> {
  const { rows: tenants } = await pool.query<{ id: string }>('SELECT id FROM app_tenant_ids() AS id');
  let deleted = 0;
  for (const t of tenants) {
    const res = await withTenant(pool, t.id, (db) =>
      db.query("DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'"));
    deleted += res.rowCount ?? 0;
  }
  return deleted;
}
```

- Call it inside `withMember` (`references/postgres-rls.md` section 4), around the use case: `idempotent(db, key, { method, path, body }, () => createCustomer(...))`.
- It covers what happens in the transaction: DB writes and jobs enqueued in it. Provider calls run in those jobs, with their own idempotency keys (`references/jobs.md`).
- Tested: a retry replays the response and creates one customer; a duplicate sent while the first is held open gets 409 at once; another body gets 422; a failed request leaves no key; the purge removes keys older than 24 hours in every tenant. Removing the advisory lock failed the 409 test: the duplicate ran the use case a second time.

## 7. Contract templates

### zod (TypeScript, shared package)

```ts
// packages/contracts/src/customers.ts
import { z } from 'zod';

export const Customer = z.object({
  id: z.uuid(),
  fullName: z.string().min(1).max(200),
  phone: z.string().regex(/^0\d{9,10}$/),   // stored as 0912345678
  email: z.email().nullable(),
  birthday: z.iso.date().nullable(),        // 'YYYY-MM-DD', a calendar date
  createdAt: z.iso.datetime(),
});
export type Customer = z.infer<typeof Customer>;

// Create input: email/birthday not required. Note .nullable() does NOT make a field optional,
// so add .optional() to let clients omit the field.
export const CreateCustomerInput = z.object({
  fullName: Customer.shape.fullName,
  phone: Customer.shape.phone,
  email: Customer.shape.email.optional(),
  birthday: Customer.shape.birthday.optional(),
});
export const UpdateCustomerInput = CreateCustomerInput.partial();

export const ListCustomersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const ListCustomersResponse = z.object({
  data: z.array(Customer),
  nextCursor: z.string().nullable(),
});
```

(zod 4. On zod 3 write `z.string().uuid()`, `z.string().email()`, `z.string().datetime()`, `z.string().date()`.)

### OpenAPI 3.1 (abridged)

```yaml
openapi: 3.1.0
info: { title: Mini CRM API, version: 1.0.0 }
paths:
  /v1/t/{tenantId}/customers:
    get:
      summary: Danh sách khách hàng của workspace
      parameters:
        - { name: tenantId, in: path, required: true, schema: { type: string, format: uuid } }
        - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
        - { name: cursor, in: query, schema: { type: string } }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/CustomerList' }
        '401': { $ref: '#/components/responses/Error' }
components:
  schemas:
    Customer:
      type: object
      required: [id, fullName, phone, email, birthday, createdAt]
      properties:
        id: { type: string, format: uuid }
        fullName: { type: string, maxLength: 200 }
        phone: { type: string, pattern: '^0\d{9,10}$' }
        email: { type: [string, 'null'], format: email }
        birthday: { type: [string, 'null'], format: date }
        createdAt: { type: string, format: date-time }
    CustomerList:
      type: object
      required: [data, nextCursor]
      properties:
        data: { type: array, items: { $ref: '#/components/schemas/Customer' } }
        nextCursor: { type: [string, 'null'] }
    Error:
      type: object
      required: [error]
      properties:
        error:
          type: object
          required: [code, message]
          properties:
            code: { type: string }
            message: { type: string }
            details: { type: object }
            requestId: { type: string }
  responses:
    Error:
      description: Lỗi
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
```

A test compares the zod `Customer` keys with the OpenAPI `Customer` properties, so the two can't drift.

### FE mocks (MSW v2)

```ts
// apps/web/src/mocks/customers.ts
import { http, HttpResponse } from 'msw';
import { customersFixture } from './fixtures/customers';

export const customerHandlers = [
  http.get('/v1/t/:tenantId/customers', () =>
    HttpResponse.json({ data: customersFixture, nextCursor: null })),
  http.post('/v1/t/:tenantId/customers', async ({ request }) => {
    const body = (await request.json()) as { email?: string | null };
    if (body.email === 'taken@example.com') {
      return HttpResponse.json(
        { error: { code: 'customer_email_taken', message: 'Email này đã có trong workspace.', details: { field: 'email' } } },
        { status: 409 },
      );
    }
    return HttpResponse.json({ data: { ...customersFixture[0], ...body } }, { status: 201 });
  }),
];
```

## 8. Long-lived clients: mobile, desktop apps

Once the web is deployed, every user runs the new version. Mobile and desktop apps don't: old versions keep running on users' devices for months, and installed versions can't be rolled back.

- **API changes must stay compatible with every supported app version**: only add fields (new request fields must be optional); never rename, remove, or change the type or meaning of existing fields. Rename like a DB expand/contract: add the new field, return both, drop the old one once the last app version using it is out of support.
- **Enums can gain values**: the app handles unknown values (shows "Unknown", doesn't crash). A new value old versions can't handle is returned only to new-enough versions, based on the version header.
- **The app sends `x-app-version` and `x-app-platform` on every request from the very first release** (`ios`, `android`, `macos`, `windows`, `linux`). Log and track error metrics by version to see which version is failing.
- **Minimum version per platform**, read from config (env var, settings table, feature flag) so it can be raised without a deploy. Older versions get `426` with code `app_update_required`; the app switches to an update screen (the `vibe-mobile` skill, `references/release.md` section 6). Raise it only when really needed: a security hole, or a change that can't stay compatible.
- **Truly breaking changes**: add a new endpoint version (`/v2/...`) running alongside `/v1` until the last app version using `/v1` is out of support.
- **Keep request/response fixtures for every released app version** and run contract tests with them: old versions calling the new server must still get the right data shape.

```ts
// apps/api/src/shared/min-app-version.ts
import type { NextFunction, Request, Response } from 'express';

type Platform = 'ios' | 'android' | 'macos' | 'windows' | 'linux';
export type MinVersions = Partial<Record<Platform, string>>;

// Compare "1.10.0" with "1.9.3" numerically, part by part
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// getMin reads config on every call (short cache), so the minimum can be raised without a deploy
export function requireMinAppVersion(getMin: () => MinVersions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const platform = req.header('x-app-platform') as Platform | undefined;
    const version = req.header('x-app-version');
    const min = platform ? getMin()[platform] : undefined;
    if (!min || !version) return next();          // web sends no header: always the latest version
    if (compareVersions(version, min) < 0) {
      return res.status(426).json({
        error: {
          code: 'app_update_required',
          message: 'Phiên bản app đã cũ, vui lòng cập nhật để tiếp tục.',
          details: { minVersion: min },
        },
      });
    }
    return next();
  };
}
```

Mount the middleware before business routes; put the endpoints the update screen needs (app config, store links) before it.
