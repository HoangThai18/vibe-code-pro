// Test infrastructure (not part of the doc): fresh schema, pools, tenants with sealed credentials, fixtures
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { loadCredentials, saveCredentials } from '../src/payments/accounts';
import { newPaymentCode } from '../src/payments/payment-code';
import type { VnpMerchant } from '../src/payments/vnpay';
import type { PaymentHooks } from '../src/payments/vnpay-ipn';

const url = process.env.DATABASE_URL!;
export const admin = new pg.Pool({ connectionString: url });              // superuser: setup and checks only
export const app = new pg.Pool({ connectionString: url, options: '-c role=app_user' }); // RLS applies
export const tenantA = '00000000-0000-4000-8000-00000000000a';
export const tenantB = '00000000-0000-4000-8000-00000000000b';
export const KEY = randomBytes(32);                                       // the secret manager's key
export const PAY_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
export const vnpCreds: Record<string, { tmnCode: string; hashSecret: string }> = {
  [tenantA]: { tmnCode: 'SPAA0001', hashSecret: 'secret-a' },
  [tenantB]: { tmnCode: 'SPAB0001', hashSecret: 'secret-b' },
};
export const apiKeys: Record<string, string> = { [tenantA]: 'key-a', [tenantB]: 'key-b' };
export const merchant = (t: string): VnpMerchant => ({ ...vnpCreds[t]!, payUrl: PAY_URL });

export async function resetDb(): Promise<void> {
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  execFileSync('psql', [url, '-q', '-v', 'ON_ERROR_STOP=1', '-f', 'test/schema.sql', '-f', 'payments.sql']);
  await admin.query('GRANT USAGE ON SCHEMA public TO app_user; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user');
  await admin.query("INSERT INTO tenants (id, name) VALUES ($1, 'Spa A'), ($2, 'Spa B')", [tenantA, tenantB]);
  for (const t of [tenantA, tenantB]) {
    await saveCredentials(app, t, 'vnpay', vnpCreds[t]!, KEY);
    await saveCredentials(app, t, 'bank_transfer', { apiKey: apiKeys[t] }, KEY);
  }
}

export const getMerchant = async (t: string): Promise<VnpMerchant | null> => {
  const c = await loadCredentials<{ tmnCode: string; hashSecret: string }>(app, t, 'vnpay', KEY);
  return c && { ...c, payUrl: PAY_URL };
};
export const getApiKey = async (t: string) => (await loadCredentials<{ apiKey: string }>(app, t, 'bank_transfer', KEY))?.apiKey ?? null;

export const hooks: PaymentHooks = {
  onPaid: async (db, p) => {
    await db.query('INSERT INTO confirmations (tenant_id, payment_id) VALUES ($1, $2)', [p.tenantId, p.paymentId]);
  },
  onReview: async (db, p) => {
    await db.query('INSERT INTO reviews (tenant_id, payment_id) VALUES ($1, $2)', [p.tenantId, p.paymentId]);
  },
};

export const truncate = () => admin.query('TRUNCATE confirmations, reviews, refunds, payment_events, payments, appointments, customers');

// A customer, an appointment and a pending payment for it
export async function insertPayment(t: string, provider: string, amount: number, o: { ref?: string; expires?: string } = {}) {
  const ref = o.ref ?? newPaymentCode();
  const { rows: [row] } = await admin.query(
    `WITH c AS (INSERT INTO customers (tenant_id, full_name, phone) VALUES ($1, 'Nguyễn Thị Thảo', '09' || lpad((random() * 1e8)::int::text, 8, '0')) RETURNING id),
          a AS (INSERT INTO appointments (tenant_id, customer_id, staff_user_id, starts_at, ends_at)
                SELECT $1, id, gen_random_uuid(), now() + interval '1 day', now() + interval '1 day 1 hour' FROM c RETURNING id)
     INSERT INTO payments (tenant_id, appointment_id, provider, amount, ref, expires_at)
     SELECT $1, id, $2, $3, $4, now() + $5::interval FROM a RETURNING id, ref, created_at`,
    [t, provider, amount, ref, o.expires ?? '15 minutes']);
  return row as { id: string; ref: string; created_at: Date };
}
export const status = async (id: string) =>
  (await admin.query('SELECT status FROM payments WHERE id = $1', [id])).rows[0].status as string;
export const count = async (table: 'confirmations' | 'reviews') =>
  Number((await admin.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
