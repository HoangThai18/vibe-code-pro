# Payments: VNPay, MoMo, bank transfer (VietQR), refunds, e-invoices

How a SaaS takes payments in Vietnam without losing money to duplicates, forged callbacks or mismatched amounts. Example: a spa takes a 200,000 VND deposit when a customer books online.

**Right-size it.** One spa taking deposits by bank transfer needs sections 1, 3, 4 and 6 only. Add VNPay or MoMo when customers ask for cards or wallets. The rules in section 3 apply to every provider.

## Contents

1. Who holds the money
2. Choosing a method
3. Rules for every provider
4. Schema
5. VNPay
6. Bank transfer with VietQR
7. MoMo
8. Refunds and reconciliation
9. E-invoices
10. Charging your own customers (subscriptions)
11. Tests

## 1. Who holds the money

**Each spa contracts its own merchant account or bank account**, and its customers pay the spa directly. Your app stores that tenant's credentials and handles the callbacks.

Don't collect customers' money into your own account and pay the spas later. Decree 52/2024/NĐ-CP on cashless payments lists collection and disbursement support (thu hộ, chi hộ) and payment gateways as intermediary payment services. Those are licensed by the State Bank of Vietnam. Talk to a lawyer before designing that flow.

Credentials per tenant:
- encrypted at rest;
- read only by the server;
- never sent to the browser or written to logs (the `vibe-backend` skill, `references/app-security.md`).

## 2. Choosing a method

| Method | Customer pays with | You learn it was paid from | Refund | Notes |
|---|---|---|---|---|
| Bank transfer with a VietQR code, plus SePay or Casso | Any banking app | A webhook when money lands; match by the code in the transfer note | Manual transfer | Low cost; customers edit the note, so keep a manual-match queue |
| VNPay | Bank apps, ATM cards, international cards, QR | IPN (server-to-server GET) | Refund API | Most common gateway |
| MoMo | MoMo wallet, cards | IPN (POST JSON, reply 204) | Refund API | Wallet: 1,000–50,000,000 VND per transaction |
| Stripe | International cards | Webhook | API | Secondary sources: not available to Vietnam-registered businesses; check stripe.com/global |

## 3. Rules for every provider

1. **The callback is the truth.** Only the IPN or webhook marks a payment paid. The return URL, where the customer lands after paying, only shows the status read from your database. Verify its signature too, but never update from it: the customer can close the tab or forge it.
2. **Verify first.** Check the signature with that tenant's secret, in constant time, before acting on any field. The callback URL carries the tenant (`/v1/webhooks/vnpay/{tenantId}/ipn`), and the signature proves it.
3. **Check amount and order against your row.** Never take the amount from the client or from the callback alone.
4. **Make it idempotent.** Providers retry, and so do you.
   - Lock the payment row (`FOR UPDATE`) and change status only from `pending`.
   - Store each callback with a unique provider key.
   - A duplicate changes nothing.
5. **Side effects go in the same transaction.** Confirming the booking, the receipt and the e-invoice job are enqueued with the status change (`references/jobs.md`). If enqueueing fails, everything rolls back and the provider's retry tries again.
6. **Reply fast in the provider's format**; slow work goes to jobs.
7. **Expire only after asking the provider.** Callbacks can be late or lost. A job takes `pending` payments past `expires_at`, queries the provider (VNPay `querydr`, MoMo `/v2/gateway/api/query`) and only then marks them `expired` or `paid`. Reconcile daily against the provider's settlement report.
8. **Never touch card numbers.** Use the provider's hosted page; this keeps you out of most PCI DSS scope.
9. **Keep every callback** (`payment_events`) for disputes, without secrets.

## 4. Schema

```sql
-- Payments for appointments (deposits) or invoices. Amounts are integer VND (no minor unit).
create table payments (
  tenant_id uuid not null references tenants(id),
  id uuid primary key default gen_random_uuid(),
  ref bigint generated always as identity unique,  -- what providers and customers see: vnp_TxnRef, transfer code SPA<ref>
  appointment_id uuid not null references appointments(id),
  provider text not null check (provider in ('vnpay', 'momo', 'bank_transfer')),
  amount bigint not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'expired', 'needs_review', 'refunded')),
  provider_txn_id text,                             -- vnp_TransactionNo, MoMo transId, bank reference
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider, provider_txn_id),
  check ((status = 'paid') = (paid_at is not null) or status = 'refunded')
);
create index on payments (tenant_id, appointment_id);
create index on payments (status, expires_at) where status = 'pending';  -- reconciliation job

-- Every callback, kept for audit and to drop duplicate deliveries
create table payment_events (
  tenant_id uuid not null references tenants(id),
  id bigint generated always as identity primary key,
  provider text not null,
  event_key text not null,                          -- the provider's id for this notification
  payment_id uuid references payments(id),
  outcome text not null default 'received',
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (tenant_id, provider, event_key)
);

alter table payments enable row level security;
alter table payments force row level security;
create policy tenant_isolation on payments
  using (tenant_id = (select app_current_tenant()))
  with check (tenant_id = (select app_current_tenant()));
alter table payment_events enable row level security;
alter table payment_events force row level security;
create policy tenant_isolation on payment_events
  using (tenant_id = (select app_current_tenant()))
  with check (tenant_id = (select app_current_tenant()));
```

Notes:
- `ref` is a short number that customers can type into a transfer note.
- Uniqueness is per tenant, so one spa's data never collides with another's.
- `needs_review` means a person decides: partial payment, over payment, or a late payment after expiry.

## 5. VNPay

Facts from VNPay's official demo code (API 2.1.0):

- **Hash.** HMAC-SHA512, sent as `vnp_SecureHash`; don't send `vnp_SecureHashType` when creating the payment.
- **Encoding.** URL-encode the values *before* hashing, with spaces as `+`, as the official Node.js demo does. `URLSearchParams` and PHP `urlencode` treat `()~*!'` differently from that demo, so keep `vnp_OrderInfo` to letters, digits and spaces.
- **Old tutorials.** Many still copy v2.0.0, which used SHA256 over `secret + data`. Don't.
- **Amount.** `vnp_Amount` is VND × 100.
- **Dates.** `vnp_CreateDate` and `vnp_ExpireDate` are `yyyyMMddHHmmss` in Vietnam time. `vnp_TxnRef` must not repeat within a day.
- **Paid** means `vnp_ResponseCode = '00'` **and** `vnp_TransactionStatus = '00'`. `24` means the customer cancelled. `07` means money was taken but flagged as suspicious: approve or reject it in the merchant portal.
- **Retries.** VNPay keeps calling the IPN until it gets `00` or `02`; the retry schedule is not publicly documented.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export type VnpParams = Record<string, string>;
export type VnpMerchant = { tmnCode: string; hashSecret: string; payUrl: string };

// Same encoding as VNPay's official Node.js demo (sortObject + qs.stringify with encode: false):
// keys sorted, values URL-encoded with spaces as '+', joined with '&', then HMAC-SHA512 in lowercase hex.
const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');

export function vnpSignData(params: VnpParams): string {
  return Object.keys(params)
    .filter((k) => k.startsWith('vnp_') && k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType')
    .sort()
    .map((k) => `${k}=${enc(params[k]!)}`)
    .join('&');
}

export const vnpHash = (data: string, secret: string) =>
  createHmac('sha512', secret).update(data, 'utf8').digest('hex');

export function vnpVerify(params: VnpParams, secret: string): boolean {
  const expected = Buffer.from(vnpHash(vnpSignData(params), secret));
  const given = Buffer.from((params.vnp_SecureHash ?? '').toLowerCase());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// yyyyMMddHHmmss in Vietnam time (UTC+7, no daylight saving), whatever the server's time zone
export const vnpDate = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().replace(/\D/g, '').slice(0, 14);

// vnp_OrderInfo must be Vietnamese without diacritics and without special characters
export function vnpOrderInfo(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

export function buildVnpayUrl(
  m: VnpMerchant,
  p: { ref: string; amount: number; orderInfo: string; returnUrl: string; ipAddr: string; now?: Date; expiresInMinutes?: number },
): string {
  if (!Number.isSafeInteger(p.amount) || p.amount <= 0) throw new Error('amount must be a positive integer (VND)');
  const now = p.now ?? new Date();
  const params: VnpParams = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: m.tmnCode,
    vnp_Locale: 'vn',
    vnp_CurrCode: 'VND',
    vnp_TxnRef: p.ref,
    vnp_OrderInfo: vnpOrderInfo(p.orderInfo),
    vnp_OrderType: 'other',
    vnp_Amount: String(p.amount * 100), // VND x 100
    vnp_ReturnUrl: p.returnUrl,
    vnp_IpAddr: p.ipAddr,
    vnp_CreateDate: vnpDate(now),
    vnp_ExpireDate: vnpDate(new Date(now.getTime() + (p.expiresInMinutes ?? 15) * 60_000)),
  };
  const data = vnpSignData(params);
  return `${m.payUrl}?${data}&vnp_SecureHash=${vnpHash(data, m.hashSecret)}`;
}

// Refund request (POST JSON to the merchant_webapi transaction endpoint). The hash covers these
// fields joined with '|', in this order (official demo). TransactionType: '02' full, '03' partial.
export function vnpRefundRequest(
  m: VnpMerchant,
  p: { requestId: string; type: '02' | '03'; ref: string; amount: number; transactionNo: string;
       transactionDate: string; createdBy: string; ipAddr: string; now?: Date },
): Record<string, string> {
  const body: Record<string, string> = {
    vnp_RequestId: p.requestId, // unique per day
    vnp_Version: '2.1.0',
    vnp_Command: 'refund',
    vnp_TmnCode: m.tmnCode,
    vnp_TransactionType: p.type,
    vnp_TxnRef: p.ref,
    vnp_Amount: String(p.amount * 100),
    vnp_TransactionNo: p.transactionNo,
    vnp_TransactionDate: p.transactionDate, // vnp_PayDate of the original payment
    vnp_CreateBy: p.createdBy,
    vnp_CreateDate: vnpDate(p.now ?? new Date()),
    vnp_IpAddr: p.ipAddr,
    vnp_OrderInfo: vnpOrderInfo(`Hoan tien ${p.ref}`),
  };
  const data = [
    'vnp_RequestId', 'vnp_Version', 'vnp_Command', 'vnp_TmnCode', 'vnp_TransactionType', 'vnp_TxnRef', 'vnp_Amount',
    'vnp_TransactionNo', 'vnp_TransactionDate', 'vnp_CreateBy', 'vnp_CreateDate', 'vnp_IpAddr', 'vnp_OrderInfo',
  ].map((k) => body[k]).join('|');
  return { ...body, vnp_SecureHash: vnpHash(data, m.hashSecret) };
}
```

IPN replies (HTTP 200 with JSON), in the order the official demo checks them:

| Situation | `RspCode` |
|---|---|
| Signature invalid (or wrong merchant) | `97` |
| Payment not found in this tenant | `01` |
| Amount differs | `04` |
| Payment no longer pending | `02` |
| Recorded (paid **or** failed) | `00` |
| Unexpected error (VNPay will retry) | `99` |

```ts
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
```

## 6. Bank transfer with VietQR

Show a VietQR code with the amount and the payment code; any banking app can scan it. The quick link from vietqr.io's docs is `https://img.vietqr.io/image/<BANK_ID>-<ACCOUNT_NO>-compact2.png?amount=300000&addInfo=SPA1042&accountName=<NAME>`. `addInfo` holds at most 25 characters with no diacritics.

Each spa connects its bank account to SePay or Casso, which call your webhook when money arrives:

- **SePay.** Sends `Authorization: Apikey <key>`; an HMAC signature header is also offered (check your dashboard). It retries up to 7 times over about 33 minutes and expects HTTP 200 with `{"success": true}`.
- **Casso.** Signs its V2 webhooks with `X-Casso-Signature`; follow its docs for the algorithm.

```ts
import { timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant';
import type { Paid } from './vnpay-ipn';

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
// The transfer note carries the payment code (SPA<ref>), which customers can edit or delete.
export async function handleSepayWebhook(
  pool: Pool,
  tenantId: string,
  authorization: string | undefined,
  body: SepayTransfer,
  getApiKey: (tenantId: string) => Promise<string | null>,
  onPaid: (db: PoolClient, paid: Paid) => Promise<void>,
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

    // Only this tenant's payments are visible (RLS): a code from another spa never matches here
    const ref = /SPA(\d{1,12})/i.exec(`${body.code ?? ''} ${body.content}`)?.[1];
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
    } else {
      outcome = 'paid';
      await db.query(
        `UPDATE payments SET status = 'paid', provider_txn_id = $2, paid_at = now() WHERE id = $1`,
        [payment.id, String(body.id)],
      );
      await onPaid(db, { tenantId, paymentId: payment.id, amount: Number(payment.amount) });
    }
    await db.query(`UPDATE payment_events SET payment_id = $2, outcome = $3 WHERE id = $1`,
      [event.rows[0]!.id, payment?.id ?? null, outcome]);
    return OK;
  });
}
```

Handled cases:
- **Note edited or deleted** → `unmatched`; staff match it by hand.
- **Partial or over payment** → `needs_review`.
- **Same transfer delivered twice** → ignored.
- **Money going out** → ignored.
- **A second transfer for a paid order** → flagged for a manual refund.
- **A code that belongs to another spa** → `unmatched`, because RLS hides other tenants' payments.

## 7. MoMo

Facts from MoMo's official samples and docs (API v2):
- **Create.** `POST /v2/gateway/api/create` with `requestType: 'captureWallet'`; set the request timeout to at least 30 s.
- **IPN.** MoMo POSTs JSON to your `ipnUrl` (put the tenant in that URL). Reply **204** within 15 s.
- **Result.** `resultCode` 0 means paid; 9000 means authorized only, when `autoCapture` is false.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

// MoMo v2 signs a raw string: these keys in this order, values not URL-encoded, HMAC-SHA256 hex
export const MOMO_CREATE_KEYS = ['accessKey', 'amount', 'extraData', 'ipnUrl', 'orderId', 'orderInfo',
  'partnerCode', 'redirectUrl', 'requestId', 'requestType'] as const;
export const MOMO_IPN_KEYS = ['accessKey', 'amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType',
  'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId'] as const;

export function momoSignature(fields: Record<string, string | number>, keys: readonly string[], secretKey: string): string {
  const raw = keys.map((k) => `${k}=${fields[k] ?? ''}`).join('&');
  return createHmac('sha256', secretKey).update(raw).digest('hex');
}

// IPN: POST JSON to your ipnUrl; reply 204 within 15 s. resultCode 0 = paid.
// accessKey is yours, not in the body. Then check partnerCode, orderId and amount against your payment row.
export function momoIpnValid(body: Record<string, string | number>, accessKey: string, secretKey: string): boolean {
  const expected = Buffer.from(momoSignature({ ...body, accessKey }, MOMO_IPN_KEYS, secretKey));
  const given = Buffer.from(String(body.signature ?? ''));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

After the signature check, apply the same flow as `handleVnpayIpn`: lock the row, check `amount`, `orderId` and `partnerCode`, move from `pending`, and enqueue in the same transaction.

## 8. Refunds and reconciliation

- **Model.** Keep a `refunds` row per request (`payment_id`, amount, status, provider reference, who asked). In the same locked transaction, check that the sum of refunds never exceeds the payment.
- **Calls.** Run the provider call in a job; the refund row's id is the provider request id, so a retry never refunds twice.
- **VNPay.** Use `vnpRefundRequest` above, POSTed as JSON to `merchant_webapi/api/transaction`: type `02` is full, `03` is partial, and `vnp_RequestId` must be unique per day.
- **Bank transfer.** There is no refund API: a person transfers the money back and records it.
- **Reconciliation.** Every day, compare paid payments with the provider's settlement report and alert on any difference. Expire stale `pending` payments only after a status query (rule 7).

## 9. E-invoices (hóa đơn điện tử)

**The rules changed on 1 July 2026:**
- Decree 254/2026/NĐ-CP replaces Decree 123/2020/NĐ-CP and Decree 70/2025/NĐ-CP.
- Circular 91/2026/TT-BTC replaces Circular 32/2025/TT-BTC.
- Both implement the Law on Tax Administration No. 108/2025/QH15.

Confirm the current text with the spa's accountant before building.

- **Who is the seller.** Each spa is the seller. Store its tax code and its e-invoice provider account per tenant.
- **When to issue for services.** Issue when the service is completed, or when money is collected before or during it. Per secondary summaries of Decree 254, deposits (đặt cọc) do not trigger an invoice, but prepayments do (a prepaid treatment package, for example). So the deposit in this example waits; the invoice is issued when the appointment is completed.
- **How.** Issue through a licensed provider's API (VNPT Invoice, Viettel S-Invoice, MISA meInvoice, BKAV eHoadon, EasyInvoice) from a job triggered by the event:
  - make it idempotent with your own invoice id as the provider's transaction key;
  - store the provider's invoice number and lookup code;
  - never edit an issued invoice; use the provider's adjustment or replacement flow.
- **Household businesses.** Those with revenue above 1 billion VND a year must use coded e-invoices or e-invoices from cash registers (secondary sources).

## 10. Charging your own customers (subscriptions)

- **No unattended card subscriptions.** Secondary sources say Stripe is not available to Vietnam-registered companies. MoMo offers subscription and tokenization, and VNPay offers token payments (still with a bank OTP); both need a merchant contract.
- **The common setup.** Send a renewal invoice with a VietQR code or payment link before the period ends. The webhook marks it paid. Allow a grace period, then switch to read-only.
- **Plan limits** (staff count, branches, messages) are enforced by the server on every write, not just hidden in the UI.

## 11. Tests

Run them against a real PostgreSQL as the app role (`options: '-c role=app_user'`). Build callbacks the way the provider does: sign the IPN parameters with the tenant's secret using the same `vnpSignData` and `vnpHash`. Check that:
- the signing matches the official demo, by porting its `sortObject` + `qs.stringify(..., { encode: false })` into the test and comparing the output;
- two identical IPNs plus one racing different notification, sent with `Promise.all`, give replies `00`, `02`, `02` and exactly one confirmation;
- a tampered parameter, the wrong merchant or another spa's secret gives `97` and nothing changes;
- a wrong amount gives `04`;
- another spa's `ref` gives `01`, even when the signature is valid;
- `24` (cancelled), and `00` without `vnp_TransactionStatus` `00`, are recorded as failed with no confirmation;
- when enqueueing fails the reply is `99`, the payment stays pending, and the retry succeeds;
- bank transfer: a matching code and amount mean paid, and a retry changes nothing; a wrong key gets 401; a partial payment goes to review; another spa's code stays unmatched; a second transfer is flagged;
- MoMo: the create signature equals the official sample's raw string, and the IPN signature fails when the amount changes.

Each of these safeguards, removed alone, fails a test:
- the row lock (the racing notification then confirms twice);
- the amount check;
- the `vnp_TransactionStatus` check;
- the duplicate-delivery check;
- the transfer amount check;
- case-insensitive code matching.

## Done when

- [ ] Each spa's credentials are per tenant and encrypted; callbacks carry the tenant in the URL and are verified with that tenant's secret.
- [ ] Paid is set only by a verified callback (or a provider status query), from `pending`, once; side effects are enqueued in the same transaction.
- [ ] Amount and order are checked against the database; partial and unmatched transfers reach a person.
- [ ] A job queries stale `pending` payments before expiring them; a daily reconciliation runs.
- [ ] Refunds can never exceed the payment and never run twice.
- [ ] E-invoices are issued through a provider at the legal trigger, and the current decree was checked.

Sources:
- VNPay: official Node.js and PHP demos (2.1.0).
- MoMo: [momo-wallet/payment](https://github.com/momo-wallet/payment), [IPN handling](https://developers.momo.vn/v3/docs/payment/api/result-handling/notification/), [one-time payment limits](https://developers.momo.vn/v3/docs/payment/api/wallet/onetime/).
- SePay: webhook docs at developer.sepay.vn, and the [sepayvn/laravel-sepay](https://github.com/sepayvn/laravel-sepay) webhook payload.
- VietQR: [quick link](https://www.vietqr.io/en/danh-sach-api/link-tao-ma-nhanh/).
- Law and decrees:
  - [Decree 52/2024/NĐ-CP](https://thuvienphapluat.vn/van-ban/Tien-te-Ngan-hang/Decree-52-2024-ND-CP-regulations-on-cashless-payments-613117.aspx);
  - [EY Vietnam on Decree 254/2026](https://www.ey.com/vi_vn/technical/tax/tax-and-law-updates/nghi-dinh-254-2026-nd-cp-ve-hoa-don-dien-tu-va-chung-tu-dien-tu);
  - [Decree 254/2026 text](https://thuvienphapluat.vn/van-ban/Thue-Phi-Le-Phi/Nghi-dinh-254-2026-ND-CP-huong-dan-Luat-Quan-ly-thue-hoa-don-dien-tu-chung-tu-dien-tu-713085.aspx).
