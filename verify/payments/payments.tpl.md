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
{{payments.sql}}
```

Notes:
- `ref` is the code customers type into a transfer note and VNPay gets as `vnp_TxnRef`: 8 random Crockford base32 characters plus a check character, unique per tenant. A sequence (`SPA1042`) would let one mistyped digit pay another customer's deposit of the same amount, and would reveal the platform's volume (never expose auto-increment ids).
- Uniqueness is per tenant, and other tenant tables are referenced with composite foreign keys, so one spa's rows never point at another's.
- `needs_review` means a person decides: partial payment, over payment, a late payment after expiry, or a VNPay `07`.

```ts
{{src/payments/payment-code.ts}}
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
{{src/payments/vnpay.ts}}
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
{{src/payments/vnpay-ipn.ts}}
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
{{src/payments/bank-transfer.ts}}
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
{{src/payments/momo.ts}}
```

After the signature check, apply the same flow as `handleVnpayIpn`: lock the row, check `amount`, `orderId` and `partnerCode`, move from `pending`, and enqueue in the same transaction.

## 8. Refunds and reconciliation

- **Model.** A `refunds` row per request (schema above). `requestRefund` locks the payment row, then sums the refunds in a second statement: a sum in the locking statement itself was tested to miss a refund committed while it waited, and refunded 300,000 VND of a 200,000 VND payment.
- **Calls.** Run the provider call in a job. The row moves to `sending` and commits **before** the call, so a timeout or crash leaves a visible "outcome unknown".
- **Retries.** VNPay refuses a repeated `vnp_RequestId` only within the same day, so the same id resent after midnight (Vietnam time) is a second refund. Before resending a `sending` refund, ask `querydr`: if VNPay shows a refund on the payment (`vnp_TransactionType` `02`/`03`), record it and never resend. `vnp_RequestId` is the refund id without dashes (32 characters; VNPay's length limit was not verified: check it in the sandbox).
- **VNPay.** Type `02` is full, `03` is partial. `vnp_TransactionDate` is the payment's `vnp_CreateDate` (the vnpay library's field docs; check in the sandbox): build the payment URL with `now: payment.created_at`.
- **Bank transfer.** There is no refund API: a person transfers the money back and records it.

```ts
{{src/payments/refunds.ts}}
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
