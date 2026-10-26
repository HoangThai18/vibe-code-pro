# Tenant isolation tests

Goal: prove with tests that tenant A cannot read, update, delete or list tenant B's data, through the API and directly in the DB. Write table-driven tests so a new route gets a test by adding one row.

## 1. Seed two tenants

```ts
// test/helpers/tenants.ts (example: vitest + supertest; adapt to the project stack)
export async function seedTwoTenants() {
  const a = await createTenantWithUser('tenant-a');   // { tenantId, token }
  const b = await createTenantWithUser('tenant-b');
  const aCustomer = await createCustomer(a, { name: 'Khách của A', email: 'a@example.com' });
  const bCustomer = await createCustomer(b, { name: 'Khách của B', email: 'b@example.com' });
  return { a, b, aCustomer, bCustomer };
}
```

Seed through app code (or SQL with the correct tenant context), never by inserting as a superuser that skips constraints; only then do tests reflect the real path.

## 2. Table-driven API tests with controls

The tenant is in the path (`/v1/t/{tenantId}/...`, `references/api-conventions.md` section 5), so there are **two** attack paths to block: putting B's id in A's own path (blocked by tenant scope/RLS), and calling B's path directly (blocked by the membership check).

Isolation tests also pass easily while checking nothing: a route with a wrong path returns 404 too, and an empty list also "contains none of B's data". So every negative check comes with a **positive control**: the same request by the owner must succeed.

```ts
// test/customers.isolation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { seedTwoTenants } from './helpers/tenants';

// Re-seed for each test so tests don't depend on run order
let ctx: Awaited<ReturnType<typeof seedTwoTenants>>;
beforeEach(async () => { ctx = await seedTwoTenants(); });

type Route = {
  name: string;
  method: 'get' | 'patch' | 'post' | 'delete';
  path: (tenantId: string, id: string) => string;
  body?: object;
};

// One row per route with a tenant resource :id (exactly the routes the app has)
const crossTenantRoutes: Route[] = [
  { name: 'GET customers/:id', method: 'get', path: (t, id) => `/v1/t/${t}/customers/${id}` },
  { name: 'PATCH customers/:id', method: 'patch', path: (t, id) => `/v1/t/${t}/customers/${id}`, body: { name: 'hack' } },
  { name: 'POST customers/:id/archive', method: 'post', path: (t, id) => `/v1/t/${t}/customers/${id}/archive` },
];

function call(route: Route, tenantId: string, id: string, token: string) {
  const req = request(app)[route.method](route.path(tenantId, id)).set('Authorization', `Bearer ${token}`);
  return route.body ? req.send(route.body) : req;
}

describe('tenant isolation: customers', () => {
  it.each(crossTenantRoutes)('$name: tenant A cannot touch tenant B data', async (route) => {
    // 1. B's id in A's path (A is a member of A): tenant scope / RLS must block
    expect((await call(route, ctx.a.tenantId, ctx.bCustomer.id, ctx.a.token)).status).toBe(404);
    // 2. B's path (A is not a member): the membership check must block
    expect((await call(route, ctx.b.tenantId, ctx.bCustomer.id, ctx.a.token)).status).toBe(404);

    // 404 is not enough: B's data is unchanged
    const fromB = await call(crossTenantRoutes[0]!, ctx.b.tenantId, ctx.bCustomer.id, ctx.b.token);
    expect(fromB.body.data).toMatchObject({ name: 'Khách của B', status: 'active' });

    // Control: B itself making the same request succeeds. Without this step,
    // a wrong or missing route also returns 404 and the test passes without checking anything.
    const own = await call(route, ctx.b.tenantId, ctx.bCustomer.id, ctx.b.token);
    expect(own.status).toBeLessThan(300);
  });

  it('list for A includes A rows, not B rows; A cannot read the list for B', async () => {
    const res = await request(app).get(`/v1/t/${ctx.a.tenantId}/customers?limit=100`)
      .set('Authorization', `Bearer ${ctx.a.token}`);
    const ids = res.body.data.map((c: { id: string }) => c.id);
    expect(ids).toContain(ctx.aCustomer.id);        // control: an empty list fails this test
    expect(ids).not.toContain(ctx.bCustomer.id);

    const other = await request(app).get(`/v1/t/${ctx.b.tenantId}/customers`)
      .set('Authorization', `Bearer ${ctx.a.token}`);
    expect(other.status).toBe(404);
  });

  it('tenantId sent by the client in the body is ignored', async () => {
    const res = await request(app).post(`/v1/t/${ctx.a.tenantId}/customers`)
      .set('Authorization', `Bearer ${ctx.a.token}`)
      .send({ name: 'Tạo lậu', tenantId: ctx.b.tenantId });
    expect(res.status).toBe(201);
    const get = crossTenantRoutes[0]!;
    expect((await call(get, ctx.a.tenantId, res.body.data.id, ctx.a.token)).status).toBe(200);   // belongs to A
    expect((await call(get, ctx.b.tenantId, res.body.data.id, ctx.b.token)).status).toBe(404);   // not B's
  });

  it('cannot reference a resource of another tenant', async () => {
    const orders = `/v1/t/${ctx.a.tenantId}/orders`;
    const cross = await request(app).post(orders).set('Authorization', `Bearer ${ctx.a.token}`)
      .send({ customerId: ctx.bCustomer.id, items: [] });
    expect([400, 404, 422]).toContain(cross.status);
    const own = await request(app).post(orders).set('Authorization', `Bearer ${ctx.a.token}`)   // control
      .send({ customerId: ctx.aCustomer.id, items: [] });
    expect(own.status).toBe(201);
  });
});
```

Stricter: read the route list from the app's router and assert every route with `:id` is in `crossTenantRoutes`, so a new route without a test turns CI red.

## 3. Testing RLS directly in the DB

Run as the **app role** (not superuser):

```sql
-- 0. Control: tenant B context sees B's rows (if 0, the checks below prove nothing)
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_b', true);
SELECT count(*) > 0 AS should_be_true FROM customers WHERE tenant_id = :'tenant_b';
ROLLBACK;

-- 1. No context → 0 rows
BEGIN;
SELECT count(*) AS should_be_zero FROM customers;
ROLLBACK;

-- 2. Tenant A context → B's rows not visible
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_a', true);
SELECT count(*) AS should_be_zero FROM customers WHERE tenant_id = :'tenant_b';
ROLLBACK;

-- 3. Tenant A context → cannot insert a row with tenant B (policy violation error)
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_a', true);
INSERT INTO customers (tenant_id, email) VALUES (:'tenant_b', 'x@example.com');
ROLLBACK;
```

(`:'tenant_a'` is psql variable syntax: `psql -v tenant_a=... -v tenant_b=...`. In test code, pass parameters normally.)

## 4. Checklist for each new table or endpoint
- [ ] Cross-tenant read / update / delete → 404 via both paths (B's id in A's path; B's path), with a control: the owner making the same request succeeds
- [ ] Lists include the current tenant's data and none of other tenants'
- [ ] `tenantId` from the client is ignored
- [ ] Cross-tenant references are rejected (composite FK)
- [ ] The new table is absent from the RLS check query results in `references/postgres-rls.md` section 8
- [ ] Tests run as the app role, not superuser
