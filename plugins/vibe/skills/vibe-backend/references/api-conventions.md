# Default API conventions

A starting point when the project has no conventions yet. If the project has its own, follow them. Once decided, record a summary in `AGENTS.md`.

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
| 409 | Conflict: duplicate unique value, stale version |
| 422 | Valid format but breaks a business rule |
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
- Each endpoint documents its required permission (e.g. `customers:write`).

## 6. Idempotency
POSTs that create resources with side effects accept `Idempotency-Key`. The server stores key + result (per tenant) for about 24h; a repeated key returns the stored result instead of redoing the work.

## 7. Contract templates

### zod (TypeScript, shared package)

```ts
// packages/contracts/src/customers.ts
import { z } from 'zod';

export const Customer = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  email: z.string().email().nullable(),
  phone: z.string().max(20).nullable(),
  status: z.enum(['active', 'archived']),
  createdAt: z.string().datetime(),
});
export type Customer = z.infer<typeof Customer>;

// Create input: email/phone not required. Note .nullable() does NOT make a field optional,
// so add .optional() to let clients omit the field.
export const CreateCustomerInput = z.object({
  name: Customer.shape.name,
  email: Customer.shape.email.optional(),
  phone: Customer.shape.phone.optional(),
});
export const UpdateCustomerInput = CreateCustomerInput.partial();

export const ListCustomersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  status: z.enum(['active', 'archived']).optional(),
});

export const ListCustomersResponse = z.object({
  data: z.array(Customer),
  nextCursor: z.string().nullable(),
});
```

(zod v4 still runs the code above; shorter forms are `z.uuid()`, `z.email()`, `z.iso.datetime()`.)

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
      required: [id, name, status, createdAt]
      properties:
        id: { type: string, format: uuid }
        name: { type: string, maxLength: 200 }
        email: { type: [string, 'null'], format: email }
        status: { type: string, enum: [active, archived] }
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
