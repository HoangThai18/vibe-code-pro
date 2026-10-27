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
  { name: 'PATCH customers/:id', method: 'patch', path: (t, id) => `/v1/t/${t}/customers/${id}`, body: { fullName: 'hack' } },
  { name: 'DELETE customers/:id', method: 'delete', path: (t, id) => `/v1/t/${t}/customers/${id}` },
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
    expect(fromB.body.data).toMatchObject({ fullName: 'Khách của B' });

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
      .send({ fullName: 'Tạo lậu', phone: '0911111111', tenantId: ctx.b.tenantId });
    expect(res.status).toBe(201);
    const get = crossTenantRoutes[0]!;
    expect((await call(get, ctx.a.tenantId, res.body.data.id, ctx.a.token)).status).toBe(200);   // belongs to A
    expect((await call(get, ctx.b.tenantId, res.body.data.id, ctx.b.token)).status).toBe(404);   // not B's
  });

  it('cannot reference a resource of another tenant', async () => {
    const appointments = `/v1/t/${ctx.a.tenantId}/appointments`;
    const slot = { staffUserId: ctx.a.userId, startsAt: '2026-11-02T03:00:00Z', endsAt: '2026-11-02T04:00:00Z' };
    const cross = await request(app).post(appointments).set('Authorization', `Bearer ${ctx.a.token}`)
      .send({ customerId: ctx.bCustomer.id, ...slot });
    expect([400, 404, 422]).toContain(cross.status);
    const own = await request(app).post(appointments).set('Authorization', `Bearer ${ctx.a.token}`)   // control
      .send({ customerId: ctx.aCustomer.id, ...slot });
    expect(own.status).toBe(201);
  });
});
