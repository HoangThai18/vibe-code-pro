import type { Pool } from 'pg';
import { withTenant } from '../db/tenant';
import { openSecret, sealSecret } from '../security/secret-box';

type Provider = 'vnpay' | 'momo' | 'bank_transfer';

// Each spa's own credentials: { tmnCode, hashSecret } for VNPay, { partnerCode, accessKey, secretKey } for MoMo,
// { apiKey } for SePay. key: 32 bytes from the secret manager, e.g. Buffer.from(process.env.SECRETS_KEY!, 'base64')
export async function saveCredentials(pool: Pool, tenantId: string, provider: Provider, credentials: object, key: Buffer) {
  await withTenant(pool, tenantId, (db) => db.query(
    `INSERT INTO payment_accounts (tenant_id, provider, credentials_sealed) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, provider) DO UPDATE SET credentials_sealed = EXCLUDED.credentials_sealed, updated_at = now()`,
    [tenantId, provider, sealSecret(JSON.stringify(credentials), key)]));
}

// Server only: never return these to the browser or put them in logs
export async function loadCredentials<T>(pool: Pool, tenantId: string, provider: Provider, key: Buffer): Promise<T | null> {
  const { rows: [row] } = await withTenant(pool, tenantId, (db) => db.query<{ credentials_sealed: Buffer }>(
    'SELECT credentials_sealed FROM payment_accounts WHERE provider = $1', [provider]));
  return row ? (JSON.parse(openSecret(row.credentials_sealed, key)) as T) : null;
}
