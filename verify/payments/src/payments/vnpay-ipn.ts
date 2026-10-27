import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant';
import { vnpVerify, type VnpMerchant, type VnpParams } from './vnpay';

export type IpnReply = { RspCode: '00' | '01' | '02' | '04' | '97' | '99'; Message: string };
export type Paid = { tenantId: string; paymentId: string; amount: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /v1/webhooks/vnpay/{tenantId}/ipn: each spa registers this URL with its own merchant account.
// No user session: the signature, checked with that tenant's secret, is the only authentication.
export async function handleVnpayIpn(
  pool: Pool,
  tenantId: string,
  query: VnpParams,
  getMerchant: (tenantId: string) => Promise<VnpMerchant | null>,
  onPaid: (db: PoolClient, paid: Paid) => Promise<void>, // enqueue confirmation/receipt jobs here, same transaction
): Promise<IpnReply> {
  try {
    const merchant = UUID.test(tenantId) ? await getMerchant(tenantId) : null;
    if (!merchant || query.vnp_TmnCode !== merchant.tmnCode || !vnpVerify(query, merchant.hashSecret)) {
      return { RspCode: '97', Message: 'Invalid signature' };
    }
    const ref = query.vnp_TxnRef ?? '';
    if (!/^\d{1,18}$/.test(ref)) return { RspCode: '01', Message: 'Order not found' };

    return await withTenant(pool, tenantId, async (db) => {
      await db.query(
        `INSERT INTO payment_events (tenant_id, provider, event_key, payload)
         VALUES ($1, 'vnpay', $2, $3) ON CONFLICT DO NOTHING`,
        [tenantId, `${ref}:${query.vnp_TransactionNo ?? ''}:${query.vnp_ResponseCode ?? ''}`, query],
      );
      // FOR UPDATE: two deliveries of the same IPN at once are processed one after the other
      const { rows } = await db.query<{ id: string; amount: string; status: string }>(
        `SELECT id, amount, status FROM payments WHERE provider = 'vnpay' AND ref = $1 FOR UPDATE`,
        [ref],
      );
      const payment = rows[0];
      if (!payment) return { RspCode: '01', Message: 'Order not found' };
      if (query.vnp_Amount !== String(Number(payment.amount) * 100)) return { RspCode: '04', Message: 'Invalid amount' };
      if (payment.status !== 'pending') return { RspCode: '02', Message: 'Order already confirmed' };

      const success = query.vnp_ResponseCode === '00' && query.vnp_TransactionStatus === '00';
      await db.query(
        `UPDATE payments SET status = $2, provider_txn_id = $3, paid_at = CASE WHEN $2 = 'paid' THEN now() END
         WHERE id = $1`,
        [payment.id, success ? 'paid' : 'failed', query.vnp_TransactionNo ?? null],
      );
      if (success) await onPaid(db, { tenantId, paymentId: payment.id, amount: Number(payment.amount) });
      return { RspCode: '00', Message: 'Confirm Success' }; // also for a failed payment: we recorded it
    });
  } catch (err) {
    console.error('vnpay ipn failed', { tenantId, ref: query.vnp_TxnRef, err }); // never log the secret
    return { RspCode: '99', Message: 'Unknow error' }; // VNPay's spelling
  }
}
