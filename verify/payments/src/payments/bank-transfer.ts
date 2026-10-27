import { timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant';
import { findPaymentCode } from './payment-code';
import type { PaymentHooks } from './vnpay-ipn';

// SePay webhook body (fields from SePay's own integration code)
export type SepayTransfer = {
  id: number; gateway: string; transactionDate: string; accountNumber: string;
  code: string | null; content: string; transferType: 'in' | 'out';
  transferAmount: number; referenceCode: string; description: string;
};
type Reply = { status: number; body: { success: boolean } };
const OK: Reply = { status: 200, body: { success: true } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// POST /v1/webhooks/sepay/{tenantId}: each spa connects its own bank account, with its own API key.
// The transfer note carries the payment code (SPA<ref>), which customers can edit, mistype or delete.
export async function handleSepayWebhook(
  pool: Pool,
  tenantId: string,
  authorization: string | undefined,
  body: SepayTransfer,
  getApiKey: (tenantId: string) => Promise<string | null>,
  hooks: PaymentHooks,
): Promise<Reply> {
  const key = UUID.test(tenantId) ? await getApiKey(tenantId) : null;
  if (!key || !sameText(authorization ?? '', `Apikey ${key}`)) return { status: 401, body: { success: false } };
  if (body.transferType !== 'in') return OK; // money going out of the account

  return withTenant(pool, tenantId, async (db) => {
    const event = await db.query<{ id: string }>(
      `INSERT INTO payment_events (tenant_id, provider, event_key, payload)
       VALUES ($1, 'bank_transfer', $2, $3) ON CONFLICT DO NOTHING RETURNING id`,
      [tenantId, String(body.id), body],
    );
    if (event.rowCount === 0) return OK; // SePay retried a delivery we already processed

    // Only this tenant's payments are visible (RLS): a code from another spa never matches here.
    // A mistyped code fails its check character and stays unmatched instead of paying someone else's deposit.
    const ref = findPaymentCode(`${body.code ?? ''} ${body.content}`);
    const { rows } = ref
      ? await db.query<{ id: string; amount: string; status: string }>(
          `SELECT id, amount, status FROM payments WHERE provider = 'bank_transfer' AND ref = $1 FOR UPDATE`, [ref])
      : { rows: [] };
    const payment = rows[0];

    let outcome: string;
    if (!payment) outcome = 'unmatched'; // staff matches it by hand from the list of unmatched transfers
    else if (payment.status !== 'pending') outcome = 'already_settled'; // paid twice or after expiry: review, refund by hand
    else if (body.transferAmount !== Number(payment.amount)) {
      outcome = 'amount_mismatch'; // partial or over payment: never auto-confirm
      await db.query(`UPDATE payments SET status = 'needs_review' WHERE id = $1`, [payment.id]);
      await hooks.onReview(db, { tenantId, paymentId: payment.id, amount: Number(payment.amount) });
    } else {
      outcome = 'paid';
      await db.query(
        `UPDATE payments SET status = 'paid', provider_txn_id = $2, paid_at = now() WHERE id = $1`,
        [payment.id, String(body.id)],
      );
      await hooks.onPaid(db, { tenantId, paymentId: payment.id, amount: Number(payment.amount) });
    }
    await db.query(`UPDATE payment_events SET payment_id = $2, outcome = $3 WHERE id = $1`,
      [event.rows[0]!.id, payment?.id ?? null, outcome]);
    return OK;
  });
}
