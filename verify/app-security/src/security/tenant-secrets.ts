// apps/api/src/security/tenant-secrets.ts — inside withTenant / withMember
import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { openSecret, sealSecret } from './secret-box';

// SECRET_BOX_KEYS from the secret manager, e.g. '{"1":"<base64 of 32 random bytes>","2":"..."}'.
// The highest version seals new values; older ones stay loaded until every row is re-sealed.
export interface KeyRing { current: number; keys: ReadonlyMap<number, Buffer> }

export function loadKeyRing(json: string): KeyRing {
  const keys = new Map(Object.entries(JSON.parse(json) as Record<string, string>)
    .map(([version, b64]) => [Number(version), Buffer.from(b64, 'base64')] as const));
  if (keys.size === 0) throw new Error('SECRET_BOX_KEYS is empty');
  return { current: Math.max(...keys.keys()), keys };
}

function keyFor(ring: KeyRing, version: number): Buffer {
  const key = ring.keys.get(version);
  if (!key) throw new Error(`secret key version ${version} is not loaded`);
  return key;
}

// Check the URL first (section 3). Returns the secret once, for the customer's receiver.
export async function createWebhookEndpoint(db: PoolClient, ring: KeyRing, url: string) {
  const secret = `whsec_${randomBytes(32).toString('base64url')}`;
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO webhook_endpoints (url, secret_sealed, key_version) VALUES ($1, $2, $3) RETURNING id',
    [url, sealSecret(secret, keyFor(ring, ring.current)), ring.current],
  );
  return { id: rows[0]!.id, secret };
}

// Opened only in the job that signs and sends; never logged, never returned by the API again
export async function webhookSecret(db: PoolClient, ring: KeyRing, endpointId: string): Promise<string | null> {
  const { rows } = await db.query<{ secret_sealed: Buffer; key_version: number }>(
    'SELECT secret_sealed, key_version FROM webhook_endpoints WHERE id = $1', [endpointId]);
  return rows[0] ? openSecret(rows[0].secret_sealed, keyFor(ring, rows[0].key_version)) : null;
}

// Key rotation: re-seal the rows still on an older key, tenant by tenant
export async function resealWebhookSecrets(db: PoolClient, ring: KeyRing): Promise<number> {
  const { rows } = await db.query<{ id: string; secret_sealed: Buffer; key_version: number }>(
    'SELECT id, secret_sealed, key_version FROM webhook_endpoints WHERE key_version < $1 FOR UPDATE', [ring.current]);
  for (const r of rows) {
    const plain = openSecret(r.secret_sealed, keyFor(ring, r.key_version));
    await db.query('UPDATE webhook_endpoints SET secret_sealed = $2, key_version = $3 WHERE id = $1',
      [r.id, sealSecret(plain, keyFor(ring, ring.current)), ring.current]);
  }
  return rows.length;
}
