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

Credentials per tenant (section 4, `payment_accounts`):
- sealed at rest: `payment_accounts.credentials_sealed` holds `sealSecret(JSON.stringify(credentials), key)` (AES-256-GCM), the key is in a secret manager, never in the database (`references/app-security.md`, "Tenant secrets"), and `openSecret` runs only when a callback or job needs it; the example uses one key: to rotate keys, add a `key_version` column and a key ring as in that section;
- read only by the server;
- never sent to the browser or written to logs.

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
   - Lock the payment row (`FOR UPDATE`) and change status only from `pending` (or from `needs_review` once the spa decided a VNPay `07`).
   - Store each callback with a unique provider key.
   - A duplicate changes nothing.
5. **Side effects go in the same transaction.** Confirming the booking, the receipt and the e-invoice job are enqueued with the status change (`references/jobs.md`). If enqueueing fails, everything rolls back and the provider's retry tries again.
6. **Reply fast in the provider's format**; slow work goes to jobs.
7. **Expire only after asking the provider.** Callbacks can be late or lost. A job takes `pending` payments past `expires_at`, queries the provider (VNPay `querydr`, MoMo `/v2/gateway/api/query`) and only then marks them `expired` or `paid`. It lists tenants with `app_tenant_ids()` (`references/postgres-rls.md`: under RLS a plain `SELECT id FROM tenants` returns no rows) and works inside `withTenant`. Reconcile daily against the provider's settlement report.
8. **Never touch card numbers.** Use the provider's hosted page; this keeps you out of most PCI DSS scope.
9. **Keep every callback** (`payment_events`) for disputes, without secrets.

## 4. Schema

```sql
-- Each spa's own merchant credentials, sealed (references/app-security.md, "Tenant secrets")
create table payment_accounts (
  tenant_id uuid not null references tenants(id),
  provider text not null check (provider in ('vnpay', 'momo', 'bank_transfer')),
  credentials_sealed bytea not null,                -- sealSecret(JSON.stringify(credentials), key)
  updated_at timestamptz not null default now(),
  primary key (tenant_id, provider)
);

-- Payments for appointments (deposits) or invoices. Amounts are integer VND (no minor unit).
create table payments (
  tenant_id uuid not null references tenants(id),
  id uuid not null default gen_random_uuid(),
  ref text not null check (ref ~ '^[0-9A-HJKMNP-TV-Z]{9}$'), -- newPaymentCode(): vnp_TxnRef, transfer note SPA<ref>
  appointment_id uuid not null,
  provider text not null check (provider in ('vnpay', 'momo', 'bank_transfer')),
  amount bigint not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'expired', 'needs_review', 'refunded')),
  provider_txn_id text,                             -- vnp_TransactionNo, MoMo transId, bank reference
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),    -- also vnp_CreateDate: querydr and refunds send it back
  primary key (tenant_id, id),
  unique (tenant_id, ref),
  unique (tenant_id, provider, provider_txn_id),
  foreign key (tenant_id, appointment_id) references appointments (tenant_id, id),
  check ((status = 'paid') = (paid_at is not null) or status = 'refunded')
);
create index on payments (tenant_id, appointment_id);
create index on payments (tenant_id, expires_at) where status in ('pending', 'needs_review'); -- reconciliation job

-- Every callback, kept for audit and to drop duplicate deliveries
create table payment_events (
  tenant_id uuid not null references tenants(id),
  id bigint generated always as identity primary key,
  provider text not null,
  event_key text not null,                          -- the provider's id for this notification
  payment_id uuid,
  outcome text not null default 'received',
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (tenant_id, provider, event_key),
  foreign key (tenant_id, payment_id) references payments (tenant_id, id)
);

-- One row per refund request; its id (without dashes) is vnp_RequestId
create table refunds (
  tenant_id uuid not null default app_current_tenant() references tenants(id),
  id uuid not null default gen_random_uuid(),
  payment_id uuid not null,
  amount bigint not null check (amount > 0),
  status text not null default 'requested'
    check (status in ('requested', 'sending', 'succeeded', 'failed', 'needs_review')),
  requested_by uuid not null,
  sent_at timestamptz,                              -- last attempt; while 'sending' the outcome is unknown
  provider_txn_id text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, payment_id) references payments (tenant_id, id)
);
create index on refunds (tenant_id, payment_id);

do $$
declare t text;
begin
  foreach t in array array['payment_accounts', 'payments', 'payment_events', 'refunds'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = (select app_current_tenant()))
                    with check (tenant_id = (select app_current_tenant()))', t);
  end loop;
end $$;
```

Notes:
- `ref` is the code customers type into a transfer note and VNPay gets as `vnp_TxnRef`: 8 random Crockford base32 characters plus a check character, unique per tenant. A sequence (`SPA1042`) would let one mistyped digit pay another customer's deposit of the same amount, and would reveal the platform's volume (never expose auto-increment ids).
- Uniqueness is per tenant, and other tenant tables are referenced with composite foreign keys, so one spa's rows never point at another's.
- `needs_review` means a person decides: partial payment, over payment, a late payment after expiry, or a VNPay `07`.

```ts
import { randomBytes } from 'node:crypto';

// Crockford base32: no I, L, O, U, so codes read aloud or retyped from a phone stay unambiguous
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const checkValue = (body: string) => [...body].reduce((n, ch) => (n * 32 + ALPHABET.indexOf(ch)) % 37, 0);

// 8 random characters + 1 check character, unique per tenant (retry the insert on a unique violation).
// Random, not a sequence: a typo never lands on the next customer's deposit, and codes reveal no volume.
export function newPaymentCode(): string {
  for (;;) {
    const body = Array.from(randomBytes(8), (b) => ALPHABET[b & 31]).join('');
    const check = checkValue(body);
    // Values 32-36 would need Crockford's check symbols *~$=U, which banking apps strip: draw again
    if (check < 32) return body + ALPHABET[check];
  }
}

// Mod 37 is prime: any single wrong character and any two swapped neighbors fail the check
export function isPaymentCode(code: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{9}$/.test(code) && ALPHABET[checkValue(code.slice(0, 8))] === code[8];
}

// The code in a transfer note ("chuyen tien SPAK7M1Q0XA7"), or null. Accepts lower case and O/I/L for 0/1;
// a code that fails the check is a typo: unmatched, a person matches it by hand.
export function findPaymentCode(note: string): string | null {
  const typed = /\bSPA[ -]?([0-9A-Z]{9})\b/i.exec(note)?.[1];
  const code = typed?.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
  return code && isPaymentCode(code) ? code : null;
}
```

## 5. VNPay

Facts from VNPay's official demo code (API 2.1.0):

- **Hash.** HMAC-SHA512, sent as `vnp_SecureHash`; don't send `vnp_SecureHashType` when creating the payment.
- **Encoding.** URL-encode the values *before* hashing, with spaces as `+`, as the official Node.js demo does. `URLSearchParams` and PHP `urlencode` treat `()~*!'` differently from that demo, so keep `vnp_OrderInfo` to letters, digits and spaces.
- **Old tutorials.** Many still copy v2.0.0, which used SHA256 over `secret + data`. Don't.
- **Amount.** `vnp_Amount` is VND × 100.
- **Dates.** `vnp_CreateDate` and `vnp_ExpireDate` are `yyyyMMddHHmmss` in Vietnam time. `vnp_TxnRef` must not repeat within a day.
- **Paid** means `vnp_ResponseCode = '00'` **and** `vnp_TransactionStatus = '00'`. `24` means the customer cancelled. `07` (in either field) means the money was taken but the payment is flagged as suspicious: record `needs_review`, alert the spa to approve or reject it in the merchant portal, and let a later IPN or `querydr` move it to `paid` or `failed`. Recording it as `failed` would leave a charged customer with no booking.
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

// merchant_webapi requests (querydr, refund), POSTed as JSON to merchant_webapi/api/transaction.
// The hash covers the values joined with '|' in the official demo's order: keep the keys in that order.
const pipeSigned = (body: Record<string, string>, secret: string) =>
  ({ ...body, vnp_SecureHash: vnpHash(Object.values(body).join('|'), secret) });

// Payment status (querydr), for the expiry job and before resending a refund
export function vnpQueryRequest(
  m: VnpMerchant,
  p: { requestId: string; ref: string; transactionDate: string; ipAddr: string; now?: Date },
): Record<string, string> {
  return pipeSigned({
    vnp_RequestId: p.requestId, // unique per day: a fresh random id per query
    vnp_Version: '2.1.0',
    vnp_Command: 'querydr',
    vnp_TmnCode: m.tmnCode,
    vnp_TxnRef: p.ref,
    vnp_TransactionDate: p.transactionDate, // vnp_CreateDate of the payment
    vnp_CreateDate: vnpDate(p.now ?? new Date()),
    vnp_IpAddr: p.ipAddr,
    vnp_OrderInfo: vnpOrderInfo(`Truy van ${p.ref}`),
  }, m.hashSecret);
}

// Refund. TransactionType: '02' full, '03' partial
export function vnpRefundRequest(
  m: VnpMerchant,
  p: { requestId: string; type: '02' | '03'; ref: string; amount: number; transactionNo: string;
       transactionDate: string; createdBy: string; ipAddr: string; now?: Date },
): Record<string, string> {
  return pipeSigned({
    vnp_RequestId: p.requestId, // unique per day only: see sendVnpayRefund before retrying
    vnp_Version: '2.1.0',
    vnp_Command: 'refund',
    vnp_TmnCode: m.tmnCode,
    vnp_TransactionType: p.type,
    vnp_TxnRef: p.ref,
    vnp_Amount: String(p.amount * 100),
    vnp_TransactionNo: p.transactionNo,
    vnp_TransactionDate: p.transactionDate, // vnp_CreateDate of the payment
    vnp_CreateBy: p.createdBy,
    vnp_CreateDate: vnpDate(p.now ?? new Date()),
    vnp_IpAddr: p.ipAddr,
    vnp_OrderInfo: vnpOrderInfo(`Hoan tien ${p.ref}`),
  }, m.hashSecret);
}
```

IPN replies (HTTP 200 with JSON), in the order the official demo checks them:

| Situation | `RspCode` |
|---|---|
| Signature invalid (or wrong merchant) | `97` |
| Payment not found in this tenant | `01` |
| Amount differs | `04` |
| Payment no longer pending | `02` |
| Recorded (paid, failed **or** needs_review) | `00` |
| Unexpected error (VNPay will retry) | `99` |

```ts
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
```

The expiry job (`reconcileVnpay`, rule 7) runs every few minutes. For each tenant from `app_tenant_ids()`, it takes VNPay payments `pending` past `expires_at` or in `needs_review`, calls `querydr` (`vnpQueryRequest`, POSTed as JSON to `merchant_webapi/api/transaction`) with no transaction open, then runs `settleVnpay` inside `withTenant`, which locks the row and re-checks its status. One spa's failure is logged and the loop goes on. In the answer, `vnp_ResponseCode` is the query's own result and `vnp_TransactionStatus` the payment's:

| `querydr` answer | Outcome |
|---|---|
| `vnp_ResponseCode` `91` (not found: the customer never reached VNPay) | `expired` |
| `00`, status `00` | `paid` |
| `00`, status `01` (not completed; the link has expired) | `expired` |
| `00`, status `02` | `failed` |
| `00`, any other status (`07` suspicious, `04` reversed) | `needs_review` |
| any other `vnp_ResponseCode` | unchanged: ask again next run |

## 6. Bank transfer with VietQR

Show a VietQR code with the amount and the payment code; any banking app can scan it. The quick link from vietqr.io's docs is `https://img.vietqr.io/image/<BANK_ID>-<ACCOUNT_NO>-compact2.png?amount=300000&addInfo=SPAK7M1Q0XA7&accountName=<NAME>`. `addInfo` holds at most 25 characters with no diacritics.

Each spa connects its bank account to SePay or Casso, which call your webhook when money arrives:

- **SePay.** Sends `Authorization: Apikey <key>`; an HMAC signature header is also offered (check your dashboard). It retries up to 7 times over about 33 minutes and expects HTTP 200 with `{"success": true}`.
- **Casso.** Signs its V2 webhooks with `X-Casso-Signature`; follow its docs for the algorithm.

```ts
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
```

Handled cases:
- **Note edited or deleted** → `unmatched`; staff match it by hand.
- **Code mistyped or two characters swapped** → fails the check character → `unmatched`, never another deposit. Lower case, `O` for `0` and `I`/`L` for `1` are accepted.
- **Partial or over payment** → `needs_review` and an alert.
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

- **Model.** A `refunds` row per request (schema above). `requestRefund` locks the payment row, then sums the refunds in a second statement: a sum in the locking statement itself was tested to miss a refund committed while it waited, and refunded 300,000 VND of a 200,000 VND payment.
- **Calls.** Run the provider call in a job. The row moves to `sending` and commits **before** the call, so a timeout or crash leaves a visible "outcome unknown".
- **Retries.** VNPay refuses a repeated `vnp_RequestId` only within the same day, so the same id resent after midnight (Vietnam time) is a second refund. Before resending a `sending` refund, ask `querydr`: if VNPay shows a refund on the payment (`vnp_TransactionType` `02`/`03`), record it and never resend. `vnp_RequestId` is the refund id without dashes (32 characters; VNPay's length limit was not verified: check it in the sandbox).
- **VNPay.** Type `02` is full, `03` is partial. `vnp_TransactionDate` is the payment's `vnp_CreateDate` (the vnpay library's field docs; check in the sandbox): build the payment URL with `now: payment.created_at`.
- **Bank transfer.** There is no refund API: a person transfers the money back and records it.

```ts
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
```

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

Run them against a real PostgreSQL as the app role (`options: '-c role=app_user'`), with credentials sealed in `payment_accounts` and a fake VNPay for `querydr` and refunds. Build callbacks the way the provider does: sign the IPN parameters with the tenant's secret using the same `vnpSignData` and `vnpHash`. Check that:
- the signing matches the official demo, by porting its `sortObject` + `qs.stringify(..., { encode: false })` into the test and comparing the output; the refund and `querydr` hashes equal the demo's `|`-joined order;
- two identical IPNs plus one racing different notification, sent with `Promise.all` (a slow update trigger widens the race), give replies `00`, `02`, `02` and exactly one confirmation;
- a tampered parameter, the wrong merchant or another spa's secret gives `97` and nothing changes;
- a wrong amount gives `04`;
- another spa's `ref`, or a malformed one, gives `01`, even when the signature is valid;
- `24` (cancelled), and `00` without `vnp_TransactionStatus` `00`, are recorded as failed with no confirmation;
- `07` gives `needs_review` and one alert; a repeated `07` gives `02`; the later `00`/`00` makes it paid and confirmed once;
- when enqueueing fails the reply is `99`, the payment stays pending, and the retry succeeds;
- the expiry job, as the app role (which sees 0 rows in `tenants`): the table above for `00`/`00`, `91`, `07` and a query error; an unexpired payment is not queried; a later `00` settles the `07`;
- refunds: a reply lost at 23:58 and retried at 00:08 refunds once (`refund`, then `querydr`, no resend); a refund that never reached VNPay is resent after `querydr` finds nothing; an attempt in flight is not sent again; `95` marks it failed; two refunds of 150,000 at once on 200,000 accept one;
- payment codes: 2,000 new codes are distinct and valid; every single-character change and every swap of neighbors fails the check; a code glued to other letters is not found;
- bank transfer: a matching code (typed in lower case with `o` for `0`) and amount mean paid, and a retry changes nothing; a wrong key gets 401; a partial payment goes to review; a typo, a swap, a short or a long code stays unmatched even when another deposit is one typo away; another spa's code stays unmatched; a second transfer is flagged;
- MoMo: the create signature equals the official sample's raw string, and the IPN signature fails when the amount changes.

Removing any one safeguard fails a test: the row locks, the amount and `vnp_TransactionStatus` checks, the `07` mapping, the duplicate-delivery check, `querydr` before a refund resend, the in-flight guard, the check character, the word boundary, case-insensitive matching, `app_tenant_ids()`.

## Done when

- [ ] Each spa's credentials are per tenant and sealed with a key outside the database; callbacks carry the tenant in the URL and are verified with that tenant's secret.
- [ ] Paid is set only by a verified callback (or a provider status query), from `pending` (or a VNPay `07` under review), once; side effects are enqueued in the same transaction.
- [ ] Payment codes are random per tenant with a check character; a mistyped code is unmatched.
- [ ] Amount and order are checked against the database; partial and unmatched transfers reach a person.
- [ ] A job lists tenants with `app_tenant_ids()` and queries stale `pending` payments before expiring them; a daily reconciliation runs.
- [ ] Refunds can never exceed the payment; a refund with an unknown outcome is checked with `querydr` before any resend.
- [ ] E-invoices are issued through a provider at the legal trigger, and the current decree was checked.

Sources:
- VNPay: official Node.js and PHP demos (2.1.0); `querydr` and refund response codes and fields from the [vnpay](https://www.npmjs.com/package/vnpay) npm library 2.5.0 (VNPay's docs site was not reachable: check in the sandbox).
- MoMo: [momo-wallet/payment](https://github.com/momo-wallet/payment), [IPN handling](https://developers.momo.vn/v3/docs/payment/api/result-handling/notification/), [one-time payment limits](https://developers.momo.vn/v3/docs/payment/api/wallet/onetime/).
- SePay: webhook docs at developer.sepay.vn, and the [sepayvn/laravel-sepay](https://github.com/sepayvn/laravel-sepay) webhook payload.
- VietQR: [quick link](https://www.vietqr.io/en/danh-sach-api/link-tao-ma-nhanh/).
- Law and decrees:
  - [Decree 52/2024/NĐ-CP](https://thuvienphapluat.vn/van-ban/Tien-te-Ngan-hang/Decree-52-2024-ND-CP-regulations-on-cashless-payments-613117.aspx);
  - [EY Vietnam on Decree 254/2026](https://www.ey.com/vi_vn/technical/tax/tax-and-law-updates/nghi-dinh-254-2026-nd-cp-ve-hoa-don-dien-tu-va-chung-tu-dien-tu);
  - [Decree 254/2026 text](https://thuvienphapluat.vn/van-ban/Thue-Phi-Le-Phi/Nghi-dinh-254-2026-ND-CP-huong-dan-Luat-Quan-ly-thue-hoa-don-dien-tu-chung-tu-dien-tu-713085.aspx).
