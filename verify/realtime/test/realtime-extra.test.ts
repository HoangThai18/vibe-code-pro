// test/realtime-extra.test.ts — failure paths not shown in the reference
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createAppointment } from '../src/appointments';
import { makeAuthenticate } from '../src/auth';
import { withTenant } from '../src/db/tenant';
import { isMember } from '../src/realtime/sse';
import { startApp } from '../src/server';
import pg from 'pg';
import { A, APP_URL, B, CUSTOMER, admin, openStream, pool, seed, tomorrow, waitFor } from './helpers';

type App = Awaited<ReturnType<typeof startApp>>;
let app: App, ctx: Awaited<ReturnType<typeof seed>>;
const book = () => withTenant(pool, A, (db) =>
  createAppointment(db, { customerId: CUSTOMER.A, staffUserId: ctx.users.lan, startsAt: tomorrow() }));

before(async () => {
  app = await startApp({ pool, databaseUrl: APP_URL, sse: { heartbeatMs: 100, recheckMs: 60_000, retryMs: 100 } });
  await waitFor(() => app.listener.isReady());
});
after(async () => {
  await app.close();
  await Promise.all([pool.end(), admin.end()]);
});
beforeEach(async () => { ctx = await seed(); });
const sub = (tenantId: string, sid?: string) => openStream(`${app.baseUrl}/v1/t/${tenantId}/events`, sid);

test('an in-app notification reaches only its recipient; other members see only the appointment change', async () => {
  const [lan, recep] = [await sub(A, ctx.sid.lan), await sub(A, ctx.sid.recep)];
  const post = (path: string, body?: object) => fetch(`${app.baseUrl}/v1/t/${A}${path}`,
    { method: 'POST', headers: { cookie: `sid=${ctx.sid.recep}` }, body: body && JSON.stringify(body) });
  const res = await post('/appointments', { customerId: CUSTOMER.A, staffUserId: ctx.users.lan, startsAt: tomorrow() });
  const { data: appt } = (await res.json()) as { data: { id: string } };
  assert.deepEqual([(await lan.nextData()).type, (await lan.nextData()).type], ['appointment.changed', 'notification.created']);
  await post(`/appointments/${appt.id}/cancel`);
  assert.deepEqual(await recep.nextData(), { type: 'appointment.changed', id: appt.id, version: 1 });
  assert.deepEqual(await recep.nextData(), { type: 'appointment.changed', id: appt.id, version: 2 });   // nothing in between
  await Promise.all([lan.close(), recep.close()]);
});

test('removed member: the stream ends at once, reconnecting gets 404; other members keep theirs', async () => {
  const [lan, recep] = [await sub(A, ctx.sid.lan), await sub(A, ctx.sid.recep)];
  await withTenant(pool, A, (db) => db.query('DELETE FROM memberships WHERE user_id = $1', [ctx.users.lan]));
  await lan.ended(1000);
  assert.equal((await sub(A, ctx.sid.lan)).status, 404);
  const appt = await withTenant(pool, A, (db) => createAppointment(db, { customerId: CUSTOMER.A, staffUserId: ctx.users.recep, startsAt: tomorrow() }));
  assert.equal((await recep.nextData()).id, appt.id);
  await recep.close();
});

test('more than maxPerUser streams → 429; closing one frees a slot', async () => {
  const capped = await startApp({ pool, databaseUrl: APP_URL, sse: { maxPerUser: 3 } });
  try {
    const url = `${capped.baseUrl}/v1/t/${A}/events`;
    const streams = [await openStream(url, ctx.sid.recep), await openStream(url, ctx.sid.recep), await openStream(url, ctx.sid.recep)];
    assert.equal(capped.hub.count({ userId: ctx.users.recep }), 3);
    assert.equal((await openStream(url, ctx.sid.recep)).status, 429);
    await streams.pop()!.close();
    await waitFor(() => capped.hub.count() === 2);
    const again = await openStream(url, ctx.sid.recep);
    assert.equal(again.status, 200);
    await Promise.all([...streams, again].map((s) => s.close()));
    await waitFor(() => capped.hub.count() === 0);
  } finally {
    await capped.close();
  }
});

test('logout: the stream ends at the next re-check', async () => {
  const quick = await startApp({ pool, databaseUrl: APP_URL, sse: { recheckMs: 200 } });
  try {
    const s = await openStream(`${quick.baseUrl}/v1/t/${A}/events`, ctx.sid.lan);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [ctx.users.lan]);
    await s.ended(1000);
    assert.equal((await openStream(`${quick.baseUrl}/v1/t/${A}/events`, ctx.sid.lan)).status, 401);
  } finally {
    await quick.close();
  }
});

test('listener connection killed: it reconnects, tells every stream to resync, and events flow again', async () => {
  const s = await openStream(`${app.baseUrl}/v1/t/${A}/events`, ctx.sid.recep);
  const { rowCount } = await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'realtime-listener' AND datname = current_database()");
  assert.ok(rowCount! >= 1);
  await s.next((f) => f.event === 'resync', 5000);
  assert.equal(app.listener.isReady(), true);
  const appt = await book();
  assert.equal((await s.nextData()).id, appt.id);
  await s.close();
});

test('a forged or malformed NOTIFY from another DB session cannot crash the listener or cross tenants', async () => {
  const s = await openStream(`${app.baseUrl}/v1/t/${A}/events`, ctx.sid.recep);
  await admin.query("SELECT pg_notify('app_events', 'not json'), pg_notify('app_events', '{\"type\":\"x\"}')");
  await admin.query(`SELECT pg_notify('app_events', json_build_object('tenantId', $1::text, 'type', 'appointment.changed', 'id', 'giả')::text)`,
    ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']);
  const appt = await book();
  assert.equal((await s.nextData()).id, appt.id);     // the forged B event did not arrive; the stream still works
  await s.close();
});

test('role change ends the stream; the reconnect is authorized again and succeeds', async () => {
  const s = await openStream(`${app.baseUrl}/v1/t/${A}/events`, ctx.sid.lan);
  await withTenant(pool, A, (db) => db.query("UPDATE memberships SET role = 'manager' WHERE user_id = $1", [ctx.users.lan]));
  await s.ended(1000);
  const again = await openStream(`${app.baseUrl}/v1/t/${A}/events`, ctx.sid.lan);
  assert.equal(again.status, 200);
  await again.close();
});

test('client that leaves during the auth check leaves nothing behind', async () => {
  const auth = makeAuthenticate(pool);
  const slow = await startApp({
    pool, databaseUrl: APP_URL,
    authenticate: async (req) => { await new Promise((r) => setTimeout(r, 300)); return auth(req); },
  });
  const ac = new AbortController();
  const pending = fetch(`${slow.baseUrl}/v1/t/${A}/events`, { headers: { cookie: `sid=${ctx.sid.recep}` }, signal: ac.signal });
  setTimeout(() => ac.abort(), 50);
  await assert.rejects(pending);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(slow.hub.count(), 0);
  await slow.close();
});

test('shutdown ends open streams so server.close() completes', async () => {
  const other = await startApp({ pool, databaseUrl: APP_URL });
  const s = await openStream(`${other.baseUrl}/v1/t/${A}/events`, ctx.sid.recep);
  const started = Date.now();
  await other.close();
  await s.ended(1000);
  assert.ok(Date.now() - started < 1000);
});

test('Node requestTimeout does not cut a long-lived stream (it only covers receiving the request)', async () => {
  const strict = await startApp({ pool, databaseUrl: APP_URL, http: { requestTimeout: 300, connectionsCheckingInterval: 50 } });
  try {
    // Control: the timeout is active (a request whose headers never finish gets 408)
    const { connect } = await import('node:net');
    const raw = connect(Number(new URL(strict.baseUrl).port), '127.0.0.1');
    raw.write('GET /v1/t/x/events HTTP/1.1\r\nHost: x\r\n');
    const reply = await new Promise<string>((r) => raw.once('data', (d) => r(d.toString())));
    assert.match(reply, /^HTTP\/1\.1 408/);
    raw.destroy();

    const s = await openStream(`${strict.baseUrl}/v1/t/${A}/events`, ctx.sid.recep);
    await new Promise((r) => setTimeout(r, 1000));
    const appt = await book();
    assert.equal((await s.nextData()).id, appt.id);
    await s.close();
  } finally {
    await strict.close();
  }
});

test('the membership check is scoped to the tenant even when app.user_id is set too', async () => {
  // memberships' read policy also shows the user's own rows in other tenants when app.user_id is set (login flow)
  const withUser = new pg.Pool({ connectionString: APP_URL, options: `-c app.user_id=${ctx.users.minh}` });
  try {
    assert.equal(await isMember(withUser, A, ctx.users.minh), false);   // minh belongs to B only
    assert.equal(await isMember(withUser, B, ctx.users.minh), true);
  } finally {
    await withUser.end();
  }
});
