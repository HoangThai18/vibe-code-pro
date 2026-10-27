// test/realtime.test.ts — real Postgres (app role, RLS), two app instances, real HTTP streams
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createAppointment } from '../src/appointments';
import { withTenant } from '../src/db/tenant';
import { startApp } from '../src/server';
import { A, APP_URL, B, CUSTOMER, admin, openStream, pool, seed, tomorrow, waitFor } from './helpers';

type App = Awaited<ReturnType<typeof startApp>>;
let app1: App, app2: App, ctx: Awaited<ReturnType<typeof seed>>;
const sse = { heartbeatMs: 100, retryMs: 100 };
const sub = (app: App, tenantId: string, sid?: string) => openStream(`${app.baseUrl}/v1/t/${tenantId}/events`, sid);
const book = (tenantId: string, staffUserId: string) => withTenant(pool, tenantId, (db) =>
  createAppointment(db, { customerId: tenantId === A ? CUSTOMER.A : CUSTOMER.B, staffUserId, startsAt: tomorrow() }));

before(async () => {
  app1 = await startApp({ pool, databaseUrl: APP_URL, sse });
  app2 = await startApp({ pool, databaseUrl: APP_URL, sse });          // a second instance
  await waitFor(() => app1.listener.isReady() && app2.listener.isReady());
});
after(async () => {
  await Promise.all([app1.close(), app2.close()]);
  await Promise.all([pool.end(), admin.end()]);
});
beforeEach(async () => { ctx = await seed(); });

test('401 without a session, 404 for a non-member or a bad tenant id; a member gets headers, heartbeat, cleanup', async () => {
  const anon = await sub(app1, A);
  assert.equal(anon.status, 401);
  assert.equal((await anon.json()).error.code, 'unauthenticated');
  assert.equal((await sub(app1, A, ctx.sid.minh)).status, 404);           // minh belongs to B only
  assert.equal((await sub(app1, 'not-a-uuid', ctx.sid.recep)).status, 404);

  const s = await sub(app1, A, ctx.sid.recep);                             // control
  assert.deepEqual([s.status, ...['content-type', 'cache-control', 'x-accel-buffering'].map((h) => s.headers.get(h))],
    [200, 'text/event-stream; charset=utf-8', 'no-cache, no-transform', 'no']);
  assert.equal((await s.next((f) => f.retry !== undefined)).retry, '100');
  await s.next((f) => f.comment === 'ping');                               // heartbeat
  await s.close();
  await waitFor(() => app1.hub.count() === 0);                             // cleanup on close
});

test('a committed write reaches the stream; a rolled-back write never does; ids only', async () => {
  const s = await sub(app1, A, ctx.sid.recep);
  await assert.rejects(withTenant(pool, A, async (db) => {
    await createAppointment(db, { customerId: CUSTOMER.A, staffUserId: ctx.users.lan, startsAt: tomorrow() });
    throw new Error('lỗi sau khi ghi');
  }));
  const committed = await book(A, ctx.users.lan);
  // Events arrive in commit order: a leaked rollback would come first
  assert.deepEqual(await s.nextData(), { type: 'appointment.changed', id: committed.id, version: 1 });
  await s.close();
});

test("tenant isolation: A's events never reach a B stream, even for a user in both", async () => {
  const [sA, sB, sBoth] = [await sub(app1, A, ctx.sid.recep), await sub(app1, B, ctx.sid.minh), await sub(app2, B, ctx.sid.both)];
  const inA = await book(A, ctx.users.lan);
  const inB = await book(B, ctx.users.minh);
  assert.equal((await sA.nextData()).id, inA.id);
  assert.equal((await sB.nextData()).id, inB.id);         // B's first event is B's own write
  assert.equal((await sBoth.nextData()).id, inB.id);
  await Promise.all([sA.close(), sB.close(), sBoth.close()]);
});
