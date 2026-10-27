import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant';
import { vnpDate, vnpQueryRequest, vnpRefundRequest, type VnpMerchant } from './vnpay';
import type { VnpApi } from './vnpay-reconcile';

// Staff asks for a refund, inside withTenant; enqueue the refund job in the same transaction (references/jobs.md).
// The payment row lock makes two refunds at once wait for each other, so their total never exceeds the payment.
export async function requestRefund(
  db: PoolClient, p: { paymentId: string; amount: number; requestedBy: string },
): Promise<string | null> {
  const { rows: [payment] } = await db.query<{ amount: string }>(
    `SELECT amount FROM payments WHERE id = $1 AND status = 'paid' FOR UPDATE`, [p.paymentId]);
  if (!payment) return null;
  // A second statement, so it sees refunds committed while this transaction waited for the lock
  const { rows: [sum] } = await db.query<{ refunded: string }>(
    `SELECT COALESCE(sum(amount), 0) AS refunded FROM refunds WHERE payment_id = $1 AND status <> 'failed'`, [p.paymentId]);
  if (Number(sum!.refunded) + p.amount > Number(payment.amount)) return null;
  const { rows: [refund] } = await db.query<{ id: string }>(
    'INSERT INTO refunds (payment_id, amount, requested_by) VALUES ($1, $2, $3) RETURNING id',
    [p.paymentId, p.amount, p.requestedBy]);
  return refund!.id;
}

type Row = { status: string; recent: boolean; amount: string; requested_by: string; ref: string; paid: string;
  provider_txn_id: string; created_at: Date; others_sent: number };
const REJECTED = new Set(['02', '03', '91', '95', '97']); // VNPay did not refund: wrong merchant, format, not found, refused, hash

// The refund job (payload { tenantId, refundId }). 'sending' is committed before the call: after a timeout or a
// crash the outcome is unknown, and the next attempt asks VNPay (querydr) before sending again. VNPay refuses a
// repeated vnp_RequestId only within the same day, so after midnight a blind resend would refund twice.
export async function sendVnpayRefund(
  pool: Pool, job: { tenantId: string; refundId: string }, m: VnpMerchant, call: VnpApi, ipAddr: string, now = new Date(),
): Promise<'succeeded' | 'failed' | 'needs_review' | 'done'> {
  const r = await withTenant(pool, job.tenantId, async (db) => {
    const { rows: [row] } = await db.query<Row>(
      `SELECT r.status, r.sent_at > now() - interval '5 minutes' AS recent, r.amount, r.requested_by,
              p.ref, p.amount AS paid, p.provider_txn_id, p.created_at,
              (SELECT count(*) FROM refunds o WHERE o.payment_id = r.payment_id AND o.id <> r.id
                  AND o.sent_at IS NOT NULL)::int AS others_sent
         FROM refunds r JOIN payments p ON p.tenant_id = r.tenant_id AND p.id = r.payment_id
        WHERE r.id = $1 FOR UPDATE OF r`, [job.refundId]);
    if (!row || (row.status !== 'requested' && row.status !== 'sending')) return null; // finished, or another tenant's
    if (row.status === 'sending' && row.recent) throw new Error('refund attempt in flight: retry later');
    await db.query(`UPDATE refunds SET status = 'sending', sent_at = now() WHERE id = $1`, [job.refundId]);
    return row;
  });
  if (!r) return 'done';
  const finish = async (status: 'succeeded' | 'failed' | 'needs_review', transactionNo?: string) => {
    await withTenant(pool, job.tenantId, (db) => db.query(
      `UPDATE refunds SET status = $2, provider_txn_id = $3 WHERE id = $1 AND status = 'sending'`,
      [job.refundId, status, transactionNo ?? null]));
    return status; // failed, needs_review: alert staff
  };
  const transactionDate = vnpDate(r.created_at);

  if (r.status === 'sending') { // an earlier attempt may have reached VNPay
    const q = await call(vnpQueryRequest(m, {
      requestId: randomUUID().replaceAll('-', ''), ref: r.ref, transactionDate, ipAddr, now }));
    if (q.vnp_ResponseCode !== '00') throw new Error(`vnpay querydr ${q.vnp_ResponseCode}: retry later`);
    if (q.vnp_TransactionType === '02' || q.vnp_TransactionType === '03') { // VNPay has a refund: never resend
      // Another refund of this payment was sent too: querydr cannot tell which one this is, a person checks the portal
      if (r.others_sent > 0) return finish('needs_review');
      return finish(q.vnp_TransactionStatus === '09' ? 'failed' : 'succeeded', q.vnp_TransactionNo);
    }
  }
  const res = await call(vnpRefundRequest(m, {
    requestId: job.refundId.replaceAll('-', ''), // 32 characters, the same on every attempt
    type: r.amount === r.paid ? '02' : '03', ref: r.ref, amount: Number(r.amount), transactionNo: r.provider_txn_id,
    transactionDate, createdBy: r.requested_by, ipAddr, now }));
  if (res.vnp_ResponseCode === '00') return finish('succeeded', res.vnp_TransactionNo);
  if (REJECTED.has(res.vnp_ResponseCode ?? '')) return finish('failed');
  throw new Error(`vnpay refund ${res.vnp_ResponseCode}: outcome unknown, retry later`); // 94, 99...: stays 'sending'
}
