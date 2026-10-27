// test/client.test.ts — the React hook in jsdom against the real server and Postgres
import { browser } from './dom-setup';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Appointment } from '../src/appointments';
import { createAppointment } from '../src/appointments';
import { withTenant } from '../src/db/tenant';
import { startApp } from '../src/server';
import { useTenantEvents } from '../web/tenant-events';
import { A, APP_URL, B, CUSTOMER, admin, pool, seed, tomorrow, waitFor } from './helpers';

let app: Awaited<ReturnType<typeof startApp>>;
let ctx: Awaited<ReturnType<typeof seed>>;
let root: Root | undefined;
let client: QueryClient | undefined;
let fetches = 0;
const container = () => document.getElementById('root')!;
const shows = (text: string) => container().textContent!.includes(text);

function Board({ tenantId }: { tenantId: string }) {
  useTenantEvents(tenantId, app.baseUrl);
  const { data } = useQuery({
    queryKey: ['tenant', tenantId, 'appointments', 'list', {}],
    queryFn: async ({ signal }) => {
      fetches++;
      const res = await fetch(`${app.baseUrl}/v1/t/${tenantId}/appointments`, { headers: { cookie: browser.cookie }, signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as { data: Appointment[] }).data;
    },
  });
  return createElement('ul', null, (data ?? []).map((a) => createElement('li', { key: a.id }, `${a.id}:${a.status};`)));
}

function mount(tenantId: string, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  client = queryClient;
  root ??= createRoot(container());
  root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Board, { tenantId })));
  return queryClient;
}

const post = (tenantId: string, path: string, body?: object) => fetch(`${app.baseUrl}/v1/t/${tenantId}${path}`,
  { method: 'POST', headers: { cookie: `sid=${ctx.sid.recep}` }, body: body && JSON.stringify(body) });

before(async () => {
  app = await startApp({ pool, databaseUrl: APP_URL, sse: { retryMs: 100 } });
  await waitFor(() => app.listener.isReady());
});
after(async () => {
  await app.close();
  await Promise.all([pool.end(), admin.end()]);
});
beforeEach(async () => {
  ctx = await seed();
  browser.cookie = `sid=${ctx.sid.both}`;      // owner of A and B
  fetches = 0;
});
afterEach(() => {
  root?.unmount();
  root = undefined;
  client?.clear();               // drops the 5-minute gc timers that would keep Node running
});

test('the board updates live when the receptionist books and cancels', async () => {
  mount(A);
  await waitFor(() => app.hub.count({ tenantId: A }) === 1 && fetches >= 1);
  const res = await post(A, '/appointments', { customerId: CUSTOMER.A, staffUserId: ctx.users.lan, startsAt: tomorrow() });
  const { data: appt } = (await res.json()) as { data: Appointment };
  await waitFor(() => shows(`${appt.id}:booked;`));
  await post(A, `/appointments/${appt.id}/cancel`);
  await waitFor(() => shows(`${appt.id}:cancelled;`));
});

test('a missed event is recovered: after a reconnect the board refetches', async () => {
  mount(A);
  await waitFor(() => app.hub.count({ tenantId: A }) === 1);
  await new Promise((r) => setTimeout(r, 300));             // the refetch on open has settled
  // A write whose event is lost (triggers off), as if it happened while the client was offline
  const c = await admin.connect();
  let missed = '';
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL session_replication_role = replica');
    const { rows } = await c.query<{ id: string }>(
      'INSERT INTO appointments (tenant_id, customer_id, staff_user_id, starts_at) VALUES ($1, $2, $3, now()) RETURNING id',
      [A, CUSTOMER.A, ctx.users.lan]);
    missed = rows[0]!.id;
    await c.query('COMMIT');
  } finally {
    c.release();
  }
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(shows(missed), false);
  app.hub.closeAll();                                     // e.g. deploy or network drop
  await waitFor(() => shows(`${missed}:booked;`));
});

test('a burst of 50 bookings in one transaction causes one refetch, not 50', async () => {
  mount(A);
  await waitFor(() => app.hub.count({ tenantId: A }) === 1);
  await new Promise((r) => setTimeout(r, 300));             // initial fetch + refetch on open have settled
  const before = fetches;
  await withTenant(pool, A, async (db) => {
    for (let i = 0; i < 50; i++) await createAppointment(db, { customerId: CUSTOMER.A, staffUserId: ctx.users.lan, startsAt: tomorrow(i % 10) });
  });
  await waitFor(() => container().querySelectorAll('li').length === 50);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fetches - before, 1);
});

test('switching workspace closes the old stream and opens the new one', async () => {
  const queryClient = mount(A);
  await waitFor(() => app.hub.count({ tenantId: A }) === 1);
  mount(B, queryClient);
  await waitFor(() => app.hub.count({ tenantId: A }) === 0 && app.hub.count({ tenantId: B }) === 1);
  const inB = await withTenant(pool, B, (db) =>
    createAppointment(db, { customerId: CUSTOMER.B, staffUserId: ctx.users.minh, startsAt: tomorrow() }));
  await waitFor(() => shows(`${inB.id}:booked;`));
});

test('a refused stream (removed member) is retried later and recovers when access returns', async () => {
  mount(A);
  await waitFor(() => app.hub.count({ tenantId: A }) === 1);
  await withTenant(pool, A, (db) => db.query('DELETE FROM memberships WHERE user_id = $1', [ctx.users.both]));
  await waitFor(() => app.hub.count({ tenantId: A }) === 0);
  await new Promise((r) => setTimeout(r, 500));             // reconnect got 404: EventSource is CLOSED now
  assert.equal(app.hub.count({ tenantId: A }), 0);
  await admin.query("INSERT INTO memberships VALUES ($1, $2, 'owner')", [A, ctx.users.both]);
  await waitFor(() => app.hub.count({ tenantId: A }) === 1, 5000);   // the hook's own retry (2 s) reconnects
});

test('unmount closes the stream', async () => {
  mount(A);
  await waitFor(() => app.hub.count() === 1);
  root!.unmount();
  root = undefined;
  await waitFor(() => app.hub.count() === 0);
});
