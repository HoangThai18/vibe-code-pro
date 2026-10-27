// app-security.md section 8: tenant secrets sealed with AES-256-GCM, key outside the DB, rotation by key_version
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { withTenant } from '../src/db/tenant';
import { openSecret, sealSecret } from '../src/security/secret-box';
import { createWebhookEndpoint, loadKeyRing, resealWebhookSecrets, webhookSecret } from '../src/security/tenant-secrets';

const k1 = randomBytes(32);
const k2 = randomBytes(32);

test('round trip; every seal differs; format is version | iv | tag | ciphertext', () => {
  const secret = 'hashSecret-VNPay-Đặng-✓';
  const a = sealSecret(secret, k1);
  const b = sealSecret(secret, k1);
  assert.equal(openSecret(a, k1), secret);
  assert.notDeepEqual(a, b);                                   // random iv
  assert.equal(a[0], 1);
  assert.equal(a.length, 1 + 12 + 16 + Buffer.byteLength(secret));
});

test('a changed byte, another key, an unknown version or a short key all throw', () => {
  const sealed = sealSecret('MoMo secretKey', k1);
  for (const i of [1, 13, 29, sealed.length - 1]) {             // iv, tag, ciphertext start, ciphertext end
    const bad = Buffer.from(sealed);
    bad[i]! ^= 1;
    assert.throws(() => openSecret(bad, k1));
  }
  assert.throws(() => openSecret(sealed, k2));
  const v2 = Buffer.from(sealed);
  v2[0] = 2;
  assert.throws(() => openSecret(v2, k1), /unknown format/);
  assert.throws(() => sealSecret('x', randomBytes(31)), /32 bytes/);
});

// DB: the app role, RLS on webhook_endpoints
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c role=app_user' });
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const A = randomUUID();
const B = randomUUID();
before(() => admin.query("INSERT INTO tenants (id, name) VALUES ($1, 'Spa A'), ($2, 'Spa B')", [A, B]));
after(() => Promise.all([pool.end(), admin.end()]));

test('stored sealed, readable only in its tenant, re-sealed on key rotation', async () => {
  const ring1 = loadKeyRing(JSON.stringify({ 1: k1.toString('base64') }));
  const { id, secret } = await withTenant(pool, A, (db) => createWebhookEndpoint(db, ring1, 'https://crm.khachhang.vn/hook'));
  const raw = (await admin.query<{ secret_sealed: Buffer }>('SELECT secret_sealed FROM webhook_endpoints WHERE id = $1', [id])).rows[0]!;
  assert.ok(!raw.secret_sealed.toString('latin1').includes(secret));
  assert.equal(await withTenant(pool, A, (db) => webhookSecret(db, ring1, id)), secret);
  assert.equal(await withTenant(pool, B, (db) => webhookSecret(db, ring1, id)), null);

  const ring12 = loadKeyRing(JSON.stringify({ 1: k1.toString('base64'), 2: k2.toString('base64') }));
  assert.equal(await withTenant(pool, B, (db) => resealWebhookSecrets(db, ring12)), 0);   // per tenant: B has none
  assert.equal(await withTenant(pool, A, (db) => resealWebhookSecrets(db, ring12)), 1);
  assert.equal(await withTenant(pool, A, (db) => resealWebhookSecrets(db, ring12)), 0);
  const ring2 = loadKeyRing(JSON.stringify({ 2: k2.toString('base64') }));             // key 1 retired
  assert.equal(await withTenant(pool, A, (db) => webhookSecret(db, ring2, id)), secret);
  await assert.rejects(withTenant(pool, A, (db) => createWebhookEndpoint(db, ring1, 'https://x.vn/h')
    .then((e) => webhookSecret(db, ring2, e.id))), /version 1 is not loaded/);
});
