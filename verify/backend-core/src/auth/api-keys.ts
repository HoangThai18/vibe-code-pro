// src/auth/api-keys.ts
import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant';
import { authorize, isAction, type Action, type ApiKeyActor, type UserActor } from '../shared/authz';
import { HttpError, NotFoundError } from '../shared/errors';

const hashKey = (key: string) => createHash('sha256').update(key).digest();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Inside withMember. Returns the key once; only its hash is stored.
export async function createApiKey(db: PoolClient, creator: UserActor, name: string, scopes: Action[], expiresAt?: Date) {
  authorize(creator, 'api_key.manage');
  const key = `vk_live_${randomBytes(32).toString('base64url')}`;
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO api_keys (name, key_hash, scopes, created_by, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [name, hashKey(key), scopes, creator.id, expiresAt ?? null],
  );
  return { id: rows[0]!.id, key };
}

// Integration requests on /v1/t/{tenantId}/...: the key must belong to the tenant in the path
export async function withApiKey<T>(
  pool: Pool, tenantId: string, key: string,
  fn: (db: PoolClient, actor: ApiKeyActor) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) throw new NotFoundError();
  return withTenant(pool, tenantId, async (db) => {
    // RLS limits the lookup to the path tenant: another tenant's key is not found → 404, like a non-member
    const { rows } = await db.query<{ id: string; scopes: string[]; usable: boolean }>(
      `SELECT id, scopes, revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AS usable
         FROM api_keys WHERE tenant_id = app_current_tenant() AND key_hash = $1`,
      [hashKey(key)],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError();
    if (!row.usable) throw new HttpError(401, 'api_key_revoked', 'API key đã bị thu hồi hoặc hết hạn.');
    await db.query("SELECT set_config('app.actor_id', $1, true)", [row.id]);
    return fn(db, { type: 'api_key', id: row.id, scopes: row.scopes.filter(isAction) });
  });
}
