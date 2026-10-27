// Test app: wires the reference code into routes the isolation and native-auth tests call
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z, ZodError } from 'zod';
import { bookAppointment } from '../appointments/book';
import { withApiKey } from '../auth/api-keys';
import type { Provider, ProviderConfig } from '../auth/id-token';
import { authRoutes } from '../auth/routes';
import { verifyAccessToken, type TokenConfig } from '../auth/tokens';
import { CreateCustomerInput, ListCustomersQuery, UpdateCustomerInput } from '../contracts/customers';
import { retryOnDeadlock } from '../db/retry';
import { withMember } from '../db/tenant';
import { changeMemberRole } from '../members/change-role';
import { authorize, type Actor } from '../shared/authz';
import { HttpError, NotFoundError } from '../shared/errors';
import { requireMinAppVersion, type MinVersions } from '../shared/min-app-version';
import { idempotent, type Outcome } from './idempotency';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = `id, full_name AS "fullName", phone, email, birthday::text AS birthday,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"`;

export interface AppOptions {
  tokens: TokenConfig;
  providers: Record<Provider, ProviderConfig>;
  minVersions?: () => MinVersions;
  beforeCreateCustomer?: () => Promise<void>;   // tests: hold a request open to race a duplicate
}

export function buildApp(pool: Pool, o: AppOptions) {
  const app = express();
  app.use(express.json());
  app.use(requireMinAppVersion(o.minVersions ?? (() => ({}))));
  app.use(authRoutes(pool, o.tokens, o.providers));

  // Members use access tokens; integrations use API keys (vk_...) bound to the path tenant
  async function inTenant<T>(req: Request, fn: (db: PoolClient, actor: Actor) => Promise<T>): Promise<T> {
    const tenantId = String(req.params.tenantId);
    const header = req.header('authorization');
    const bearer = header?.match(/^Bearer (vk_\S+)$/)?.[1];
    if (bearer) return withApiKey(pool, tenantId, bearer, fn);
    return withMember(pool, tenantId, await verifyAccessToken(header, o.tokens), fn);
  }
  const idParam = (req: Request) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw new NotFoundError();
    return id;
  };

  app.get('/v1/t/:tenantId/customers', async (req, res) => {
    const q = ListCustomersQuery.parse(req.query);
    const rows = await inTenant(req, async (db, actor) => {
      authorize(actor, 'customer.read');
      return (await db.query(`SELECT ${COLUMNS} FROM customers ORDER BY created_at DESC, id DESC LIMIT $1`, [q.limit])).rows;
    });
    res.json({ data: rows, nextCursor: null });
  });
  app.get('/v1/t/:tenantId/customers/:id', async (req, res) => {
    const row = await inTenant(req, async (db, actor) => {
      authorize(actor, 'customer.read');
      return (await db.query(`SELECT ${COLUMNS} FROM customers WHERE id = $1`, [idParam(req)])).rows[0];
    });
    if (!row) throw new NotFoundError();
    res.json({ data: row });
  });
  app.patch('/v1/t/:tenantId/customers/:id', async (req, res) => {
    const input = UpdateCustomerInput.parse(req.body);
    const row = await inTenant(req, async (db, actor) => {
      authorize(actor, 'customer.write');
      const { rows } = await db.query(
        `UPDATE customers SET full_name = COALESCE($2, full_name), phone = COALESCE($3, phone) WHERE id = $1 RETURNING ${COLUMNS}`,
        [idParam(req), input.fullName ?? null, input.phone ?? null]);
      return rows[0];
    });
    if (!row) throw new NotFoundError();
    res.json({ data: row });
  });
  app.delete('/v1/t/:tenantId/customers/:id', async (req, res) => {
    const deleted = await inTenant(req, async (db, actor) => {
      authorize(actor, 'customer.write');
      return (await db.query('DELETE FROM customers WHERE id = $1', [idParam(req)])).rowCount;
    });
    if (!deleted) throw new NotFoundError();
    res.status(204).end();
  });
  app.post('/v1/t/:tenantId/customers', async (req, res) => {
    const input = CreateCustomerInput.parse(req.body);   // tenantId in the body is not in the schema: dropped
    const key = req.header('idempotency-key');
    const outcome = await inTenant(req, async (db, actor) => {
      authorize(actor, 'customer.write');
      const create = async (): Promise<Outcome> => {
        await o.beforeCreateCustomer?.();
        const { rows } = await db.query(
          `INSERT INTO customers (full_name, phone, email, birthday) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
          [input.fullName, input.phone, input.email ?? null, input.birthday ?? null]);
        return { status: 201, body: { data: rows[0] } };
      };
      return key ? idempotent(db, key, { method: req.method, path: req.originalUrl, body: req.body }, create) : create();
    });
    res.status(outcome.status).json(outcome.body);
  });
  app.post('/v1/t/:tenantId/appointments', async (req, res) => {
    const input = z.object({ customerId: z.uuid(), staffUserId: z.uuid(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime() })
      .parse(req.body);
    const id = await retryOnDeadlock(() => inTenant(req, (db, actor) => bookAppointment(db, actor, {
      customerId: input.customerId, staffUserId: input.staffUserId, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt),
    })));
    res.status(201).json({ data: { id } });
  });
  app.put('/v1/t/:tenantId/members/:userId/role', async (req, res) => {
    const { role } = z.object({ role: z.enum(['owner', 'manager', 'staff']) }).parse(req.body);
    await inTenant(req, (db, actor) => {
      if (actor.type !== 'user') throw new HttpError(403, 'forbidden');
      return changeMemberRole(db, actor, String(req.params.userId), role);
    });
    res.status(204).end();
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) return void res.status(400).json({ error: { code: 'validation_failed', message: 'Dữ liệu không hợp lệ.' } });
    console.error(err);
    res.status(500).json({ error: { code: 'internal', message: 'Lỗi hệ thống.' } });
  });
  return app;
}
