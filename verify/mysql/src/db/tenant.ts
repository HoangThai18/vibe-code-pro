// src/db/tenant.ts — no RLS: the tenant id travels as a value, and every query filters on it
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { Role, UserActor } from '../shared/authz';
import { NotFoundError } from '../shared/errors';

// Repositories take this, never a bare connection: the tenant comes from the checked path or the job
export interface TenantDb { conn: PoolConnection; tenantId: string }

export const errno = (err: unknown): number | undefined => (err as { errno?: number }).errno;

export async function withTransaction<T>(pool: Pool, fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();   // a failed statement undoes only itself: the transaction is still open
    throw err;
  } finally {
    conn.release();
  }
}

// 1213 ER_LOCK_DEADLOCK: InnoDB rolled back the whole transaction, so run all of it again
export async function retryOnDeadlock<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (errno(err) !== 1213 || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 5 * i + Math.random() * 20));
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Business requests: tenant from the path, user from the session. Not a member, unknown or inactive tenant: 404.
export function withMember<T>(pool: Pool, tenantId: string, userId: string,
  fn: (db: TenantDb, actor: UserActor) => Promise<T>): Promise<T> {
  if (!UUID.test(tenantId)) return Promise.reject(new NotFoundError());
  return retryOnDeadlock(() => withTransaction(pool, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.tenant_id = ? AND m.user_id = ? AND t.status = 'active'`, [tenantId, userId]);
    const role = rows[0]?.role as Role | undefined;
    if (!role) throw new NotFoundError();
    return fn({ conn, tenantId }, { type: 'user', id: userId, role });
  }));
}

// Jobs: the tenant id comes from the payload or the tenant loop
export function withTenant<T>(pool: Pool, tenantId: string, fn: (db: TenantDb) => Promise<T>): Promise<T> {
  return retryOnDeadlock(() => withTransaction(pool, (conn) => fn({ conn, tenantId })));
}
