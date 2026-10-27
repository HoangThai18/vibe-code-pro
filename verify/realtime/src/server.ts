// Test scaffolding: minimal node:http app wiring the realtime pieces to normal API routes
import { createServer, type IncomingMessage, type ServerOptions, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Pool, PoolClient } from 'pg';
import { cancelAppointment, createAppointment, listAppointments, listNotifications } from './appointments';
import { makeAuthenticate } from './auth';
import { withTenant } from './db/tenant';
import { Hub } from './realtime/hub';
import { listenForEvents } from './realtime/pg-listener';
import { streamTenantEvents, type SseOptions } from './realtime/sse';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, string>> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

export interface AppOptions {
  pool: Pool;
  databaseUrl: string;
  sse?: Partial<Omit<SseOptions, 'pool' | 'hub' | 'authenticate'>>;
  authenticate?: SseOptions['authenticate'];
  http?: ServerOptions;
}

export async function startApp(opts: AppOptions) {
  const { pool } = opts;
  const hub = new Hub();
  const listener = listenForEvents({ connectionString: opts.databaseUrl, hub });
  const authenticate = opts.authenticate ?? makeAuthenticate(pool);
  const sse: SseOptions = { pool, hub, authenticate, ...opts.sse };

  // tenant from the path, membership checked in the same transaction as the work (postgres-rls.md section 4)
  async function asMember<T>(req: IncomingMessage, tenantId: string, fn: (db: PoolClient, userId: string) => Promise<T>) {
    const user = await authenticate(req);
    if (!user) throw new HttpError(401, 'unauthenticated');
    if (!UUID.test(tenantId)) throw new HttpError(404, 'not_found');
    return withTenant(pool, tenantId, async (db) => {
      const { rowCount } = await db.query('SELECT 1 FROM memberships WHERE user_id = $1 AND tenant_id = app_current_tenant()', [user.userId]);
      if (rowCount !== 1) throw new HttpError(404, 'not_found');
      return fn(db, user.userId);
    });
  }

  const server = createServer(opts.http ?? {}, async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const m = /^\/v1\/t\/([^/]+)\/(events|appointments|notifications)(?:\/([^/]+)\/cancel)?$/.exec(url.pathname);
      if (!m) throw new HttpError(404, 'not_found');
      const [, tenantId = '', resource, id] = m;
      if (req.method === 'GET' && resource === 'events' && !id) return await streamTenantEvents(req, res, tenantId, sse);
      if (req.method === 'GET' && resource === 'appointments' && !id) {
        return json(res, 200, { data: await asMember(req, tenantId, (db) => listAppointments(db)), nextCursor: null });
      }
      if (req.method === 'POST' && resource === 'appointments' && !id) {
        const body = await readJson(req);
        const data = await asMember(req, tenantId, (db) => createAppointment(db, {
          customerId: body.customerId ?? '', staffUserId: body.staffUserId ?? '', startsAt: body.startsAt ?? '' }));
        return json(res, 201, { data });
      }
      if (req.method === 'POST' && resource === 'appointments' && id) {
        const data = await asMember(req, tenantId, (db) => cancelAppointment(db, id));
        if (!data) throw new HttpError(404, 'not_found');
        return json(res, 200, { data });
      }
      if (req.method === 'GET' && resource === 'notifications' && !id) {
        return json(res, 200, { data: await asMember(req, tenantId, (db, userId) => listNotifications(db, userId)), nextCursor: null });
      }
      throw new HttpError(404, 'not_found');
    } catch (err) {
      if (res.headersSent) return void res.end();
      if (err instanceof HttpError) return json(res, err.status, { error: { code: err.code, message: err.code } });
      json(res, 500, { error: { code: 'internal', message: 'Lỗi hệ thống.' } });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // SIGTERM in production: stop accepting, end open streams (server.close waits for them otherwise), stop listening
  async function close() {
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    hub.closeAll();
    // Tests only: also drop sockets that never sent a request (server.close waits for those);
    // production lets in-flight requests finish first, then exits
    server.closeAllConnections();
    await closed;
    await listener.stop();
  }
  return { server, hub, listener, baseUrl, close };
}
