// src/db/tenant.ts
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Role, UserActor } from '../shared/authz';
import { NotFoundError } from '../shared/errors';

export async function withTransaction<T>(pool: Pool, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function withTenant<T>(pool: Pool, tenantId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(pool, async (db) => {
    await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return fn(db);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Business requests: tenant from the path, user from the authenticated session
export async function withMember<T>(
  pool: Pool, tenantId: string, userId: string,
  fn: (db: PoolClient, actor: UserActor) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) throw new NotFoundError();   // malformed id: 404, not a 500 from ::uuid
  return withTenant(pool, tenantId, async (db) => {
    // Filter on the current tenant: membership_read alone also matches app.user_id (see above)
    const { rows } = await db.query<{ role: Role }>(
      'SELECT role FROM memberships WHERE tenant_id = app_current_tenant() AND user_id = $1', [userId]);
    const role = rows[0]?.role;
    if (!role) throw new NotFoundError();                // not a member: 404, don't reveal whether the tenant exists
    // Actor context for role-gated policies and triggers; memberships/tenants policies never read it
    await db.query("SELECT set_config('app.actor_id', $1, true), set_config('app.member_role', $2, true)", [userId, role]);
    return fn(db, { type: 'user', id: userId, role });
  });
}

// Login and workspace picker only: the one place that sets app.user_id
export function listWorkspaces(pool: Pool, userId: string) {
  return withTransaction(pool, async (db) => {
    await db.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const { rows } = await db.query<{ id: string; name: string; role: Role }>(
      `SELECT t.id, t.name, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1 AND t.status = 'active' ORDER BY t.name`, [userId]);
    return rows;
  });
}

// Sign-up: the new id is the tenant context, so the policies allow this tenant and its owner membership only
export async function createTenant(pool: Pool, ownerId: string, name: string): Promise<string> {
  const tenantId = randomUUID();
  await withTenant(pool, tenantId, async (db) => {
    await db.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [tenantId, name]);
    await db.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [tenantId, ownerId]);
  });
  return tenantId;
}
