// api-conventions.md section 6: Idempotency-Key claimed in the same transaction as the write
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { tokenConfig } from '../src/app';
import { providerConfig } from '../src/auth/id-token';
import { buildApp } from '../src/http/build-app';
import { purgeIdempotencyKeys } from '../src/jobs/purge-idempotency-keys';
import { createTenantWithUser } from './helpers/factories';
import { newAdminPool, newAppPool, reset } from './support/db';

const admin = newAdminPool();
const pool = newAppPool();
afterAll(async () => { await Promise.all([admin.end(), pool.end()]); });

// The first request waits inside the transaction until the test lets it finish
let hold: Promise<void> | null = null;
let entered: () => void = () => {};
const app = buildApp(pool, {
  tokens: tokenConfig, providers: providerConfig([], []),
  beforeCreateCustomer: async () => { entered(); await hold; },
});

let t: Awaited<ReturnType<typeof createTenantWithUser>>;
beforeEach(async () => {
  await reset(admin);
  t = await createTenantWithUser('spa');
  hold = null;
});
const post = (key: string, body: object) => request(app).post(`/v1/t/${t.tenantId}/customers`)
  .set('Authorization', `Bearer ${t.token}`).set('Idempotency-Key', key).send(body);
const customers = async () => Number((await admin.query('SELECT count(*) FROM customers')).rows[0].count);

describe('Idempotency-Key', () => {
  it('a retry replays the stored response; one customer is created', async () => {
    const body = { fullName: 'Lan', phone: '0912345678' };
    const first = await post('key-0001-abcd', body);
    const again = await post('key-0001-abcd', body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(await customers()).toBe(1);
  });

  it('a duplicate while the first is still running gets 409 idempotency_in_progress', async () => {
    let release: () => void = () => {};
    hold = new Promise((r) => { release = r; });
    const inside = new Promise<void>((r) => { entered = r; });
    const first = post('key-0002-abcd', { fullName: 'Lan', phone: '0912345678' }).then((r) => r);
    await inside;
    const dup = await post('key-0002-abcd', { fullName: 'Lan', phone: '0912345678' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('idempotency_in_progress');
    release();
    expect((await first).status).toBe(201);
    expect(await customers()).toBe(1);
  });

  it('the same key with another body → 422; a failed request leaves no key behind', async () => {
    await post('key-0003-abcd', { fullName: 'Lan', phone: '0912345678' });
    const other = await post('key-0003-abcd', { fullName: 'Minh', phone: '0987654321' });
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe('idempotency_key_reused');
    expect((await post('key-0004-abcd', { fullName: 'Trùng', phone: '0912345678' })).status).toBe(500);   // unique phone: rolled back
    expect((await admin.query("SELECT 1 FROM idempotency_keys WHERE key = 'key-0004-abcd'")).rowCount).toBe(0);
  });

  it('the purge job deletes keys older than 24 hours in every tenant', async () => {
    const t2 = await createTenantWithUser('spa-2');
    await post('key-0005-abcd', { fullName: 'Lan', phone: '0912345678' });
    await request(app).post(`/v1/t/${t2.tenantId}/customers`).set('Authorization', `Bearer ${t2.token}`)
      .set('Idempotency-Key', 'key-0006-abcd').send({ fullName: 'Minh', phone: '0987654321' });
    await admin.query("UPDATE idempotency_keys SET created_at = now() - interval '25 hours'");
    await post('key-0007-abcd', { fullName: 'Hoa', phone: '0911111111' });
    expect(await purgeIdempotencyKeys(pool)).toBe(2);
    expect((await admin.query('SELECT key FROM idempotency_keys')).rows).toEqual([{ key: 'key-0007-abcd' }]);
  });
});
