import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant';
import { vnpDate, vnpQueryRequest, type VnpMerchant } from './vnpay';
import { settleVnpay, type Outcome, type PaymentHooks } from './vnpay-ipn';

// POST JSON to merchant_webapi/api/transaction, with a timeout. Injected so tests can use a fake VNPay.
export type VnpApi = (body: Record<string, string>) => Promise<Record<string, string>>;

// querydr: vnp_ResponseCode is the query's own result, vnp_TransactionStatus the payment's. null: ask again later
export function vnpQueryOutcome(q: Record<string, string>): Outcome | null {
  if (q.vnp_ResponseCode === '91') return 'expired'; // VNPay never saw this payment
  if (q.vnp_ResponseCode !== '00') return null;
  const byStatus: Record<string, Outcome> = { '00': 'paid', '01': 'expired', '02': 'failed' };
  return byStatus[q.vnp_TransactionStatus ?? ''] ?? 'needs_review'; // 07 (suspicious), 04 (reversed): a person
}

// Scheduled every few minutes: pending payments past expires_at, and 07 payments waiting for the spa's decision.
// Callbacks can be late or lost, so ask VNPay before expiring anything.
export async function reconcileVnpay(
  pool: Pool,
  getMerchant: (tenantId: string) => Promise<VnpMerchant | null>,
  call: VnpApi,
  hooks: PaymentHooks,
  ipAddr: string,
): Promise<number> {
  // app_tenant_ids(): under RLS the app role sees no rows in tenants without a tenant context
  const { rows: tenants } = await pool.query<{ id: string }>('SELECT id FROM app_tenant_ids() AS id');
  let settled = 0;
  for (const { id: tenantId } of tenants) {
    try {
      const merchant = await getMerchant(tenantId);
      if (!merchant) continue;
      const { rows: due } = await withTenant(pool, tenantId, (db) => db.query<{ ref: string; created_at: Date }>(
        `SELECT ref, created_at FROM payments
          WHERE provider = 'vnpay' AND (status = 'pending' AND expires_at < now() OR status = 'needs_review')
          ORDER BY created_at LIMIT 100`));
      for (const p of due) {
        // No transaction is open during the HTTP call; settleVnpay locks the row and re-checks its status
        const q = await call(vnpQueryRequest(merchant, {
          requestId: randomUUID().replaceAll('-', ''), ref: p.ref, transactionDate: vnpDate(p.created_at), ipAddr }));
        const outcome = vnpQueryOutcome(q);
        if (!outcome) continue;
        const reply = await withTenant(pool, tenantId, (db) => settleVnpay(db, { tenantId, ref: p.ref, outcome,
          amount: q.vnp_ResponseCode === '91' ? null : q.vnp_Amount ?? '', transactionNo: q.vnp_TransactionNo }, hooks));
        if (reply === '00') settled++;
        if (reply === '04') console.error('vnpay querydr amount differs', { tenantId, ref: p.ref }); // alert
      }
    } catch (err) {
      console.error('vnpay reconcile failed', { tenantId, err }); // one spa's outage must not stop the others
    }
  }
  return settled;
}
