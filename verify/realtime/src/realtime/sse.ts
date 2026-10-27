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
