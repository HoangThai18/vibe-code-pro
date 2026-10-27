// test/ws.test.ts — auth on upgrade, origin check, tenant scope
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import WebSocket from 'ws';
import { createAppointment } from '../src/appointments';
import { makeAuthenticate } from '../src/auth';
import { withTenant } from '../src/db/tenant';
import { attachWebSocket } from '../src/realtime/ws';
import { startApp } from '../src/server';
import { A, APP_URL, B, CUSTOMER, admin, pool, seed, tomorrow, waitFor } from './helpers';

const ORIGIN = 'https://app.spa.example';
let app: Awaited<ReturnType<typeof startApp>>, ctx: Awaited<ReturnType<typeof seed>>;

before(async () => {
  app = await startApp({ pool, databaseUrl: APP_URL });
  attachWebSocket(app.server, { pool, hub: app.hub, authenticate: makeAuthenticate(pool), origins: [ORIGIN] });
  await waitFor(() => app.listener.isReady());
});
after(async () => {
  await app.close();
  await Promise.all([pool.end(), admin.end()]);
});
beforeEach(async () => { ctx = await seed(); });

function connect(tenantId: string, opts: { sid?: string; origin?: string } = {}) {
  const ws = new WebSocket(`${app.baseUrl.replace('http', 'ws')}/v1/t/${tenantId}/ws`, {
    origin: opts.origin ?? ORIGIN, headers: opts.sid ? { cookie: `sid=${opts.sid}` } : {} });
  const status = new Promise<number>((resolve) => {
    ws.on('open', () => resolve(101));
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('error', () => {});
  });
  return { ws, status };
}

test('upgrade is refused for a foreign origin (403), no session (401), a non-member (404)', async () => {
  assert.equal(await connect(A, { sid: ctx.sid.recep, origin: 'https://evil.example' }).status, 403);
  assert.equal(await connect(A).status, 401);
  assert.equal(await connect(A, { sid: ctx.sid.minh }).status, 404);
  const ok = connect(A, { sid: ctx.sid.recep });              // control
  assert.equal(await ok.status, 101);
  ok.ws.close();
});

test("a member receives its tenant's invalidations only; closing frees the hub entry", async () => {
  const a = connect(A, { sid: ctx.sid.recep });
  const b = connect(B, { sid: ctx.sid.minh });
  assert.equal(await a.status, 101);
  assert.equal(await b.status, 101);
  const nextMessage = (ws: WebSocket) => new Promise<Record<string, unknown>>((r) => ws.once('message', (d) => r(JSON.parse(String(d)))));
  const gotA = nextMessage(a.ws);
  const gotB = nextMessage(b.ws);
  const inA = await withTenant(pool, A, (db) => createAppointment(db, { customerId: CUSTOMER.A, staffUserId: ctx.users.lan, startsAt: tomorrow() }));
  const inB = await withTenant(pool, B, (db) => createAppointment(db, { customerId: CUSTOMER.B, staffUserId: ctx.users.minh, startsAt: tomorrow() }));
  assert.deepEqual(await gotA, { event: 'invalidate', type: 'appointment.changed', id: inA.id, version: 1 });
  assert.equal((await gotB).id, inB.id);
  a.ws.close();
  b.ws.close();
  await waitFor(() => app.hub.count() === 0);
});
