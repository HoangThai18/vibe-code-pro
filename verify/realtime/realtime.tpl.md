# Realtime: live updates and in-app notifications

Tell open screens "something changed": the appointment board and notification badge update live, never across tenants, never stale after reconnects.

**Right-size it.** Few users, 30–60 s delay acceptable: poll (`refetchInterval` + `refetchOnWindowFocus`) and skip this file. One instance still needs the trigger and listener (they tie events to commits).

Ran on Node 22, PostgreSQL 16 (FORCE RLS, app role without BYPASSRLS), pg 8.23, React 19.3, TanStack Query 5.104; removing the tenant filter, membership check, cleanup on close, notify-in-transaction, refetch on reconnect or coalescing failed a test.

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
{{sql/realtime.sql}}
```

Postgres delivers only after COMMIT, in commit order, folds identical payloads per transaction, caps payloads below 8000 bytes. Each instance keeps its streams in a hub fed by one listening connection:

```ts
{{src/realtime/hub.ts}}
```

```ts
{{src/realtime/pg-listener.ts}}
```

- Dedicated connection, not from the pool (PgBouncer transaction pooling never supports LISTEN), and no transactions on it: notifications arrive only between transactions, and a long one blocks cleanup of the 8 GB queue (full queue: NOTIFY fails at commit).
- One channel, tenant in payload, filtered in the hub; per-tenant channels only if measured volume demands.

```ts
{{src/realtime/sse.ts}}
```

- Route `GET /v1/t/{tenantId}/events` here; start `listenForEvents` once per process, sharing the `Hub`.
- Heartbeat 15 s (the HTML spec's suggestion; nginx drops a proxied connection silent for 60 s). `X-Accel-Buffering: no` stops nginx buffering; no compression here.
- Membership delete/change closes the stream at once; the re-check catches logout and expiry. Reconnects get 401/404, and any non-200 stops `EventSource` for good, so the client retries itself.
- Cross-origin API: CORS with credentials, exact app origin.

## 4. Client: EventSource + TanStack Query

```ts
{{web/tenant-events.ts}}
```

- Keys as in the `vibe-frontend` skill (`references/state-management.md`): `['tenant', tenantId, ...]`. Only mounted queries refetch.
- `EventSource` sends cookies but no custom headers; token clients need a fetch-based SSE client. No long-lived tokens in URLs.
- Toasts ("Lịch hẹn mới") use refetched data, not the event.
- React Native has no `EventSource` (networking docs: fetch, WebSocket): refetch on foreground (TanStack `focusManager` + `AppState`), poll while active, or use an SSE library; background apps lose connections.

## 5. WebSocket

Only for many client messages. Same hub and rules, plus: auth and membership check in the `upgrade` handler before `handleUpgrade`; an `Origin` allowlist (browsers send cookies on cross-site handshakes); `maxPayload`; validate, authorize, rate-limit each message (`references/app-security.md`); ping ~30 s, terminate peers without pong (`ws` README).

## 6. Tests

Helpers (not shown): `openStream` = fetch + SSE parser; `seed` = two spas, users, sessions; `startApp` = `node:http` app wiring these modules.

```ts
{{test/realtime.test.ts}}
```

- Negatives without sleeps: forbidden write first, control write second; the first event must be the control (commit order).
- Also tested: recipient-only notifications; removed member; 429; logout; listener killed → `resync`; shutdown.
- Client (jsdom + `eventsource` package, real server): live update, lost event recovered on reconnect, 50 bookings in one transaction → 1 refetch (50 uncoalesced), workspace switch, refused stream retried. `queryClient.clear()` after each test, or gc timers keep Node alive.

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
