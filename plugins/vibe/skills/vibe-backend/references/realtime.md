# Realtime: live updates and in-app notifications

Tell open screens "something changed": the appointment board and notification badge update live, never across tenants, never stale after reconnects.

**Right-size it.** Few users, 30–60 s delay acceptable: poll (`refetchInterval` + `refetchOnWindowFocus`) and skip this file. One instance still needs the trigger and listener (they tie events to commits).

Ran on Node 22, PostgreSQL 16 (FORCE RLS, app role without BYPASSRLS), pg 8.23, React 19.3, TanStack Query 5.104; removing the tenant filter, membership check (or its tenant predicate), cleanup on close, notify-in-transaction, refetch on reconnect or coalescing fails a test.

## Contents
1. Choosing a transport
2. The rule: events are hints
3. Server: trigger, listener, SSE
4. Client: EventSource + TanStack Query
5. WebSocket
6. Tests
7. Operations and scale

## 1. Choosing a transport

| Option | Fits | Cost |
|---|---|---|
| Polling | Few users, 30–60 s delay fine, serverless | A request per client per interval |
| **SSE** (default) | Server → client: boards, badges, progress | A long-lived response per tab; HTTP/2 |
| WebSocket | Clients send many messages (chat, co-editing) | Upgrade auth, origin check, own ping |
| Hosted (Supabase Realtime, Pusher, Ably) | No long-lived connections on your hosting, huge fan-out | Vendor in the data path |

Spa app: SSE server → client; writes stay normal HTTP calls.

Hosted: publish from a job enqueued in the writing transaction (`references/jobs.md`); one private channel per tenant, authorized by your server (Pusher `private-` channels, Ably short-lived tokens, Supabase `private: true` + RLS on `realtime.messages`, and Broadcast over Postgres Changes past ~3,000 subscribers); ids only (`references/privacy.md`).

## 2. The rule: events are hints

- The database is the truth. Events carry ids and `version` only; clients refetch through the normal API (session, membership, RLS, record permissions).
- Missed events are normal (deploys, drops, sleeping phones): refetch what is on screen on every (re)connect.
- No ordering logic: refetches read the latest state; `invalidateQueries` cancels the in-flight fetch (`cancelRefetch`).
- No `id:` is sent, so no `Last-Event-ID` returns; refetch on `open` covers it. Replay (events table, bigint `id:`) only if refetching is too expensive.

## 3. Server: trigger, listener, SSE

A trigger in the writing transaction makes every write path emit (reception, online booking, jobs):

```sql
-- Runs inside the writing transaction; delivered only on COMMIT. Ids only: any DB session can LISTEN.
CREATE OR REPLACE FUNCTION notify_app_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r jsonb := to_jsonb(COALESCE(NEW, OLD));
BEGIN
  PERFORM pg_notify('app_events', jsonb_strip_nulls(jsonb_build_object(
    'tenantId', r->>'tenant_id',
    'type',     TG_ARGV[0],
    'id',       r->>'id',
    'version',  r->'version',
    'userId',   r->>'user_id'      -- per-user rows only: delivered to that user alone
  ))::text);
  RETURN NULL;
END $$;

CREATE TRIGGER appointments_notify AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION notify_app_event('appointment.changed');
CREATE TRIGGER user_notifications_notify AFTER INSERT ON user_notifications
  FOR EACH ROW EXECUTE FUNCTION notify_app_event('notification.created');
CREATE TRIGGER memberships_notify AFTER UPDATE OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION notify_app_event('membership.changed');
```

Postgres delivers only after COMMIT, in commit order, folds identical payloads per transaction, caps payloads below 8000 bytes. Each instance keeps its streams in a hub fed by one listening connection:

```ts
// apps/api/src/realtime/hub.ts — the open streams of this instance
export interface AppEvent {
  tenantId: string;
  type: string;          // 'appointment.changed' | 'notification.created' | 'membership.changed'
  id?: string;
  version?: number;
  userId?: string;       // set: only this user's streams get it
}

export interface Stream {
  tenantId: string;
  userId: string;
  send(event: 'invalidate' | 'resync', data: object): void;
  close(): void;
}

export class Hub {
  readonly #streams = new Set<Stream>();

  add(stream: Stream): () => void {
    this.#streams.add(stream);
    return () => this.#streams.delete(stream);
  }

  publish(event: AppEvent): void {
    for (const s of this.#streams) {
      if (s.tenantId !== event.tenantId) continue;                 // tenant isolation
      if (event.userId && s.userId !== event.userId) continue;     // per-user events
      if (event.type === 'membership.changed') s.close();          // re-authorize: the client reconnects
      else s.send('invalidate', { type: event.type, id: event.id, version: event.version });
    }
  }

  resyncAll(): void { for (const s of this.#streams) s.send('resync', {}); }   // events may be lost
  closeAll(): void { for (const s of [...this.#streams]) s.close(); }           // shutdown

  count(f: { tenantId?: string; userId?: string } = {}): number {
    return [...this.#streams].filter((s) => (!f.tenantId || s.tenantId === f.tenantId) && (!f.userId || s.userId === f.userId)).length;
  }
}
```

```ts
// apps/api/src/realtime/pg-listener.ts — one dedicated connection per instance, never from the pool
import pg from 'pg';
import type { AppEvent, Hub } from './hub';

export function listenForEvents(opts: { connectionString: string; hub: Hub }) {
  let client: pg.Client | undefined;
  let ready = false, stopped = false, failures = 0;
  let pending = Promise.resolve();
  const start = () => { pending = connect(); };

  async function connect(): Promise<void> {
    if (stopped) return;
    const c = new pg.Client({ connectionString: opts.connectionString, keepAlive: true, application_name: 'realtime-listener' });
    let retried = false;
    const retry = (err?: unknown) => {
      ready = false;
      if (stopped || retried) return;
      retried = true;
      console.error('realtime listener down', err);   // the project's logger
      setTimeout(start, Math.min(30_000, 500 * 2 ** failures++) * (0.5 + Math.random() / 2));
    };
    c.on('error', retry).on('end', () => retry());
    c.on('notification', (msg) => {
      try {
        if (msg.channel === 'app_events') opts.hub.publish(JSON.parse(msg.payload ?? '') as AppEvent);
      } catch (err) {
        console.error('bad realtime payload', err);   // any DB session may NOTIFY: a forged event costs a refetch
      }
    });
    try {
      await c.connect();
      await c.query('LISTEN app_events');
      client = c;
      ready = true;
      failures = 0;
      opts.hub.resyncAll();     // events sent while we were not listening are lost
    } catch (err) {
      retry(err);
      c.end().catch(() => {});
    }
  }

  start();
  return {
    isReady: () => ready,       // readiness check: no traffic before LISTEN is active
    stop: async () => {
      stopped = true;
      await pending;            // let a connect in progress finish
      await client?.end();
    },
  };
}
```

- Dedicated connection, not from the pool (PgBouncer transaction pooling never supports LISTEN), and no transactions on it: notifications arrive only between transactions, and a long one blocks cleanup of the 8 GB queue (full queue: NOTIFY fails at commit).
- One channel, tenant in payload, filtered in the hub; per-tenant channels only if measured volume demands.

```ts
// apps/api/src/realtime/sse.ts — GET /v1/t/{tenantId}/events
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant';
import type { Hub } from './hub';

export interface SseOptions {
  pool: Pool;
  hub: Hub;
  authenticate: (req: IncomingMessage) => Promise<{ userId: string } | null>;   // same check as every endpoint
  heartbeatMs?: number;    // below proxy idle timeouts (nginx: 60 s)
  recheckMs?: number;      // catches logout/expiry; membership changes are pushed
  maxPerUser?: number;     // per instance
  retryMs?: number;        // default: random 3-7 s
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function isMember(pool: Pool, tenantId: string, userId: string): Promise<boolean> {
  if (!UUID.test(tenantId)) return false;
  return withTenant(pool, tenantId, async (db) =>
    (await db.query('SELECT 1 FROM memberships WHERE user_id = $1 AND tenant_id = app_current_tenant()', [userId])).rowCount === 1);
}

const sendError = (res: ServerResponse, status: number, code: string, message: string) =>
  void res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { code, message } }));

export async function streamTenantEvents(req: IncomingMessage, res: ServerResponse, tenantId: string, o: SseOptions) {
  const user = await o.authenticate(req);
  if (!user) return sendError(res, 401, 'unauthenticated', 'Vui lòng đăng nhập.');
  if (!(await isMember(o.pool, tenantId, user.userId))) return sendError(res, 404, 'not_found', 'Không tìm thấy.');
  if (o.hub.count({ userId: user.userId }) >= (o.maxPerUser ?? 10)) return sendError(res, 429, 'too_many_streams', 'Quá nhiều kết nối.');
  if (res.destroyed) return;               // client left during the checks

  let open = true;
  const write = (chunk: string) => { if (open) res.write(chunk); };
  const close = () => {
    if (!open) return;
    open = false;
    clearInterval(heartbeat);
    clearInterval(recheck);
    remove();
    res.end();
  };
  // Subscribe BEFORE sending headers: anything committed after the client's `open` reaches it
  const remove = o.hub.add({
    tenantId, userId: user.userId, close,
    send: (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',            // nginx: do not buffer this response
  });
  // Random delay: after a deploy, clients do not all reconnect and refetch at once
  write(`retry: ${o.retryMs ?? (3000 + Math.floor(Math.random() * 4000))}\n\n`);
  const heartbeat = setInterval(() => write(': ping\n\n'), o.heartbeatMs ?? 15_000);
  const recheck = setInterval(() => {
    o.authenticate(req)
      .then(async (u) => u?.userId === user.userId && (await isMember(o.pool, tenantId, user.userId)))
      .catch(() => false)                   // cannot verify: end it; the reconnect is checked again
      .then((ok) => { if (!ok) close(); });
  }, o.recheckMs ?? 300_000);
  res.on('close', close);                   // client gone: free timers and the hub entry
}
```

- Route `GET /v1/t/{tenantId}/events` here; start `listenForEvents` once per process, sharing the `Hub`.
- Heartbeat 15 s (the HTML spec's suggestion; nginx drops a proxied connection silent for 60 s). `X-Accel-Buffering: no` stops nginx buffering; no compression here.
- Membership delete/change closes the stream at once; the re-check catches logout and expiry. Reconnects get 401/404, and any non-200 stops `EventSource` for good, so the client retries itself.
- Cross-origin API: CORS with credentials, exact app origin.

## 4. Client: EventSource + TanStack Query

```ts
// apps/web/src/realtime/tenant-events.ts
import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

// Event type → key group under ['tenant', tenantId, ...]
const groups: Record<string, string> = {
  'appointment.changed': 'appointments',
  'notification.created': 'notifications',
};

type Timer = ReturnType<typeof setTimeout> | undefined;

export function connectTenantEvents(queryClient: QueryClient, tenantId: string, baseUrl = ''): () => void {
  let es: EventSource | undefined;
  let retryTimer: Timer, flushTimer: Timer;
  let failures = 0;
  const pending = new Set<string>();          // '*' = the whole tenant
  // Coalesce bursts (one event per row of a bulk import) into one refetch per group
  const invalidate = (group: string) => {
    pending.add(group);
    flushTimer ??= setTimeout(() => {
      flushTimer = undefined;
      const keys = pending.has('*') ? [['tenant', tenantId]] : [...pending].map((g) => ['tenant', tenantId, g]);
      pending.clear();
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
    }, 100);
  };

  const connect = () => {
    es = new EventSource(`${baseUrl}/v1/t/${tenantId}/events`, { withCredentials: true });
    // Every (re)connect may have missed events: refetch what is on screen
    es.addEventListener('open', () => { failures = 0; invalidate('*'); });
    es.addEventListener('resync', () => invalidate('*'));
    es.addEventListener('invalidate', (e) => {
      const { type } = JSON.parse(e.data) as { type: string };
      invalidate(groups[type] ?? '*');        // unknown type (newer server): refetch all
    });
    es.addEventListener('error', () => {
      // Network drop: EventSource reconnects itself. A non-200 answer closes it for good: retry slowly
      if (es?.readyState !== EventSource.CLOSED) return;
      retryTimer = setTimeout(connect, Math.min(60_000, 2_000 * 2 ** failures++));
    });
  };

  connect();
  return () => { es?.close(); clearTimeout(retryTimer); clearTimeout(flushTimer); };
}

// Mount once in the workspace layout: each call opens a connection.
// Workspace switch (new tenantId): the cleanup closes the old stream first.
export function useTenantEvents(tenantId: string, baseUrl = '') {
  const queryClient = useQueryClient();
  useEffect(() => connectTenantEvents(queryClient, tenantId, baseUrl), [queryClient, tenantId, baseUrl]);
}
```

- Keys as in the `vibe-frontend` skill (`references/state-management.md`): `['tenant', tenantId, ...]`. Only mounted queries refetch.
- `EventSource` sends cookies but no custom headers; token clients need a fetch-based SSE client. No long-lived tokens in URLs.
- Toasts ("Lịch hẹn mới") use refetched data, not the event.
- React Native has no `EventSource` (networking docs: fetch, WebSocket): refetch on foreground (TanStack `focusManager` + `AppState`), poll while active, or use an SSE library; background apps lose connections.

## 5. WebSocket

Only for many client messages. Same hub and rules, plus: auth and membership check in the `upgrade` handler before `handleUpgrade`; an `Origin` allowlist (browsers send cookies on cross-site handshakes); `maxPayload`; validate, authorize, rate-limit each message (`references/app-security.md`); ping ~30 s, terminate peers without pong (`ws` README).

## 6. Tests

Real Postgres as the app role (RLS), two app instances, real HTTP streams read with `fetch` and a small SSE parser, two spas with users and sessions. Check that:
- no session gives 401 `unauthenticated`; a non-member or a bad tenant id gives 404; a member gets `text/event-stream; charset=utf-8`, `no-cache, no-transform`, `X-Accel-Buffering: no`, the `retry:` line and heartbeats; closing frees the hub entry;
- a rolled-back write never reaches the stream; a committed one does, as `{ type, id, version }` only;
- A's write never reaches a B stream, even on the other instance for a user in both spas;
- negatives need no sleeps: forbidden write first, control write second; the first event must be the control (commit order);
- also: recipient-only notifications; a removed member's stream ends and its reconnect gets 404; a role change ends the stream and the reconnect succeeds; 429 past `maxPerUser`; logout ends the stream at the re-check; listener killed → `resync`, then events flow; forged or malformed `NOTIFY` is ignored; a client leaving during the auth check leaves nothing; shutdown ends streams; Node's `requestTimeout` does not cut a stream; with `app.user_id` also set, a B-only user is not a member of A; WebSocket: 403 foreign origin, 401, 404, tenant-only invalidations;
- client (jsdom + `eventsource` package, real server): live update, lost event recovered on reconnect, 50 bookings in one transaction → 1 refetch (50 uncoalesced), workspace switch, refused stream retried, unmount closes. `queryClient.clear()` after each test, or gc timers keep Node alive.

## 7. Operations and scale

- Metrics (the `vibe-ship` skill, `references/observability.md`): open streams (`hub.count()`), connects/s, listener reconnects, `pg_notification_queue_usage()` > 0.5.
- Measured: ~7 KB heap, 16–24 KB RSS, one file descriptor per stream (2,000–5,000 streams). Re-check: 5 SQL statements per stream; 5,000 streams every 5 min ≈ 83/s.
- Browsers allow 6 HTTP/1.1 connections per domain across tabs: serve HTTP/2.
- Proxy/load-balancer idle timeouts must exceed the heartbeat; Node's `requestTimeout` only covers receiving the request (tested).
- SIGTERM: `server.close()` waits for open responses: call `hub.closeAll()`; clients return after the random 3–7 s `retry`. Readiness waits for `listener.isReady()`.
- Serverless caps duration, ending streams: prefer polling or hosted.

## Done when

- [ ] Events: ids/version only, emitted in the writing transaction
- [ ] Stream: same auth and membership check; 401/404/429 tested
- [ ] Test proves tenant A's events never reach tenant B
- [ ] Removed member's stream ends; logout within the re-check
- [ ] Client refetches on `open`/`resync`, coalesces, retries refused streams
- [ ] Heartbeat below proxy timeouts, `X-Accel-Buffering: no`, HTTP/2; dedicated reconnecting listener; readiness and shutdown handle streams

Sources: https://www.postgresql.org/docs/16/sql-notify.html, https://www.postgresql.org/docs/16/sql-listen.html, https://www.pgbouncer.org/features.html, https://html.spec.whatwg.org/multipage/server-sent-events.html, https://developer.mozilla.org/en-US/docs/Web/API/EventSource, https://nginx.org/en/docs/http/ngx_http_proxy_module.html, https://nodejs.org/docs/latest-v22.x/api/http.html, https://tanstack.com/query/latest/docs/framework/react/react-native, https://reactnative.dev/docs/network, https://github.com/websockets/ws, https://supabase.com/docs/guides/realtime/postgres-changes, https://supabase.com/docs/guides/realtime/authorization, https://github.com/pusher/pusher-js, https://ably.com/docs/auth, https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html.
