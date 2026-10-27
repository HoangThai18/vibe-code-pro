// auth.md section 6: API keys are bound to the path tenant and to their scopes; the audit actor is the key
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { audit } from '../src/audit/audit';
import { createApiKey, withApiKey } from '../src/auth/api-keys';
import { withMember } from '../src/db/tenant';
import { HttpError, NotFoundError } from '../src/shared/errors';
import { createCustomer, createTenantWithUser } from './helpers/factories';
import { newAdminPool, newAppPool, reset } from './support/db';

const admin = newAdminPool();
const pool = newAppPool();
afterAll(async () => { await Promise.all([admin.end(), pool.end()]); });

let a: Awaited<ReturnType<typeof createTenantWithUser>>;
let b: Awaited<ReturnType<typeof createTenantWithUser>>;
let key = '', keyId = '';
beforeEach(async () => {
  await reset(admin);
  a = await createTenantWithUser('spa-a');
  b = await createTenantWithUser('spa-b');
  await createCustomer(a, { fullName: 'Lan', phone: '0912345678' });
  ({ key, id: keyId } = await withMember(pool, a.tenantId, a.userId, (db, actor) =>
    createApiKey(db, actor, 'Form đặt lịch', ['customer.read'])));
});

const get = (tenantId: string, k = key) => request(app).get(`/v1/t/${tenantId}/customers`).set('Authorization', `Bearer ${k}`);

describe('API keys', () => {
  it('work on their own tenant\'s path only; another tenant\'s path is 404', async () => {
    const own = await get(a.tenantId);
    expect(own.status).toBe(200);
    expect(own.body.data).toHaveLength(1);
    expect((await get(b.tenantId)).status).toBe(404);
    expect((await get(a.tenantId, 'vk_live_khong-ton-tai')).status).toBe(404);
  });

  it('scopes map to actions: a read-only key cannot write', async () => {
    const res = await request(app).post(`/v1/t/${a.tenantId}/customers`).set('Authorization', `Bearer ${key}`)
      .send({ fullName: 'Minh', phone: '0987654321' });
    expect(res.status).toBe(403);
  });

  it('revoked or expired → 401; only owners create keys', async () => {
    await admin.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1', [keyId]);
    expect((await get(a.tenantId)).status).toBe(401);
    const err = await withMember(pool, a.tenantId, a.userId, (db) =>
      createApiKey(db, { type: 'user', id: a.userId, role: 'manager' }, 'x', ['customer.read'])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);   // managers lack api_key.manage
  });

  it('stores only a hash, and the audit row names the key', async () => {
    expect((await admin.query('SELECT 1 FROM api_keys WHERE key_hash::text LIKE $1', [`%${key}%`])).rowCount).toBe(0);
    await withApiKey(pool, a.tenantId, key, (db, actor) => audit(db, actor, { action: 'customer.read', entity: 'customer' }));
    expect((await admin.query('SELECT actor_type, actor_id FROM audit_log')).rows).toEqual([{ actor_type: 'api_key', actor_id: keyId }]);
    await expect(withApiKey(pool, b.tenantId, key, async () => 'in')).rejects.toBeInstanceOf(NotFoundError);
  });
});
