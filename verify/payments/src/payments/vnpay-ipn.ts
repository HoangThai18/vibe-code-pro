import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant';
import { isPaymentCode } from './payment-code';
import { vnpVerify, type VnpMerchant, type VnpParams } from './vnpay';

export type IpnReply = { RspCode: '00' | '01' | '02' | '04' | '97' | '99'; Message: string };
export type Paid = { tenantId: string; paymentId: string; amount: number };
export type PaymentHooks = {
  onPaid: (db: PoolClient, p: Paid) => Promise<void>;   // enqueue confirmation and receipt jobs: same transaction
  onReview: (db: PoolClient, p: Paid) => Promise<void>; // alert staff: a person decides
};
export type Outcome = 'paid' | 'failed' | 'expired' | 'needs_review';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// IPN: paid only when both codes are 00. 07 in either: the money was taken but VNPay flagged the payment
// as suspicious; the spa approves or rejects it in the merchant portal, and a later IPN or querydr records that.
export function vnpOutcome(responseCode = '', transactionStatus = ''): Outcome {
  if (responseCode === '07' || transactionStatus === '07') return 'needs_review';
  return responseCode === '00' && transactionStatus === '00' ? 'paid' : 'failed';
}

// The one place a VNPay payment leaves pending (or needs_review, once the spa decided). Inside withTenant.
export async function settleVnpay(
  db: PoolClient,
  s: { tenantId: string; ref: string; outcome: Outcome; amount: string | null; transactionNo: string | undefined },
  hooks: PaymentHooks,
): Promise<'00' | '01' | '02' | '04'> {
  // FOR UPDATE: two deliveries of the same IPN, or an IPN and the expiry job, run one after the other
  const { rows: [payment] } = await db.query<{ id: string; amount: string; status: string }>(
    `SELECT id, amount, status FROM payments WHERE provider = 'vnpay' AND ref = $1 FOR UPDATE`, [s.ref]);
  if (!payment) return '01';
  if (s.amount !== null && s.amount !== String(Number(payment.amount) * 100)) return '04'; // null: nothing was paid
  const open = payment.status === 'pending'
    || (payment.status === 'needs_review' && (s.outcome === 'paid' || s.outcome === 'failed'));
  if (!open) return '02';

  await db.query(
    `UPDATE payments SET status = $2, provider_txn_id = COALESCE($3, provider_txn_id),
            paid_at = CASE WHEN $2 = 'paid' THEN now() END
      WHERE id = $1`,
    [payment.id, s.outcome, s.transactionNo ?? null],
  );
  const paid: Paid = { tenantId: s.tenantId, paymentId: payment.id, amount: Number(payment.amount) };
  if (s.outcome === 'paid') await hooks.onPaid(db, paid);
  if (s.outcome === 'needs_review') await hooks.onReview(db, paid);
  return '00';
}

const REPLIES: Record<'00' | '01' | '02' | '04', IpnReply> = {
  '00': { RspCode: '00', Message: 'Confirm Success' }, // also for a failed payment: we recorded it
  '01': { RspCode: '01', Message: 'Order not found' },
  '02': { RspCode: '02', Message: 'Order already confirmed' },
  '04': { RspCode: '04', Message: 'Invalid amount' },
};

// GET /v1/webhooks/vnpay/{tenantId}/ipn: each spa registers this URL with its own merchant account.
// No user session: the signature, checked with that tenant's secret, is the only authentication.
export async function handleVnpayIpn(
  pool: Pool,
  tenantId: string,
  query: VnpParams,
  getMerchant: (tenantId: string) => Promise<VnpMerchant | null>,
  hooks: PaymentHooks,
): Promise<IpnReply> {
  try {
    const merchant = UUID.test(tenantId) ? await getMerchant(tenantId) : null;
    if (!merchant || query.vnp_TmnCode !== merchant.tmnCode || !vnpVerify(query, merchant.hashSecret)) {
      return { RspCode: '97', Message: 'Invalid signature' };
    }
    const ref = query.vnp_TxnRef ?? '';
    if (!isPaymentCode(ref)) return REPLIES['01'];

    return await withTenant(pool, tenantId, async (db) => {
      await db.query(
        `INSERT INTO payment_events (tenant_id, provider, event_key, payload)
         VALUES ($1, 'vnpay', $2, $3) ON CONFLICT DO NOTHING`,
        [tenantId, `${ref}:${query.vnp_TransactionNo ?? ''}:${query.vnp_ResponseCode ?? ''}`, query],
      );
      const outcome = vnpOutcome(query.vnp_ResponseCode, query.vnp_TransactionStatus);
      return REPLIES[await settleVnpay(db, { tenantId, ref, outcome, amount: query.vnp_Amount ?? '',
        transactionNo: query.vnp_TransactionNo }, hooks)];
    });
  } catch (err) {
    console.error('vnpay ipn failed', { tenantId, ref: query.vnp_TxnRef, err }); // never log the secret
    return { RspCode: '99', Message: 'Unknow error' }; // VNPay's spelling
  }
}
