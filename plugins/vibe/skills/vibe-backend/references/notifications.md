# Notifications: email, Zalo and SMS that arrive and stay legal

Getting messages delivered (not into spam, not blocked) and within Vietnamese rules: appointment reminders, OTPs, receipts and the occasional promotion. Sending reliably (queues, retries, idempotency) is in the `vibe-backend` skill, `references/jobs.md`. This file covers each channel's own rules.

**Right-size it.** Transactional email only (receipts, password reset) needs section 3's DNS setup and nothing else. Add Zalo or SMS when reminders matter. Read the advertising rules before the first promotion.

## Contents

1. Choosing a channel
2. Rules for every channel
3. Email
4. Zalo template messages (ZBS, formerly ZNS)
5. SMS brandname
6. OTP abuse
7. Tests

## 1. Choosing a channel

| Message | First choice | Fallback | Why |
|---|---|---|---|
| Appointment reminder, booking confirmation | Zalo template, tag 1 (transaction) | SMS (customer-care brandname) | Most Vietnamese phones have Zalo, and a template message costs a few hundred đồng |
| OTP | SMS, or a Zalo authentication template | The other one | Must arrive in seconds; abuse costs money (section 6) |
| Receipt, invoice, password reset | Email | | Needs a permanent copy and attachments |
| Promotion | Whichever channel the customer consented to | None without consent | Consent, hours and frequency rules apply (sections 2, 5) |

## 2. Rules for every channel

1. **Separate transactional from marketing.** They differ in consent, limits, Zalo tag, email stream and brandname type. Store `kind` on every message, and never put an offer inside a reminder (on Zalo that alone makes it tag 3).
2. **Check consent, hours and limits at send time, in the job.** Don't check them when the campaign is queued: consent can be withdrawn in between (`references/privacy.md`). Reserve the send in the same short transaction as the check (section 5), or two campaigns checking at once both pass.
3. **One notification id is the idempotency key** with every provider (Zalo `tracking_id`, the SMS provider's request id). A retried job never sends twice.
4. **Fallback only for "can't reach this person here".** Examples: no Zalo account, or the user refused Zalo messages. A provider outage is not one of them: retry later on the same channel. Record each attempt.
5. **Per-tenant identity and cost:**
   - each spa sends as itself (its Zalo OA, its brandname, its name in the email display name), with its credentials sealed (`references/app-security.md`, "Tenant secrets");
   - set a daily quota per tenant;
   - alert on a spending jump.
6. **Minimal content.** A reminder needs the first name, time and place, not the treatment or a health note.

```sql
-- Advertising messages per customer and channel: the 24-hour limit is counted from here. A row is
-- reserved before sending (reserveAdvertisingSend) and deleted only if the send failed for good.
create table marketing_messages (
  tenant_id uuid not null default app_current_tenant() references tenants(id),
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  channel text not null check (channel in ('zalo', 'sms', 'email')),
  campaign_id uuid not null,
  status text not null default 'reserved' check (status in ('reserved', 'sent')),
  sent_at timestamptz not null default now(),              -- reserved at, just before the send
  primary key (tenant_id, id),
  unique (tenant_id, campaign_id, customer_id, channel),   -- a retried job never sends a campaign twice
  foreign key (tenant_id, customer_id) references customers (tenant_id, id)
);
create index on marketing_messages (tenant_id, customer_id, channel, sent_at);
alter table marketing_messages enable row level security;
alter table marketing_messages force row level security;
create policy tenant_isolation on marketing_messages
  using (tenant_id = (select app_current_tenant()))
  with check (tenant_id = (select app_current_tenant()));

-- One Zalo OA token pair per tenant, sealed (references/app-security.md, "Tenant secrets").
-- Zalo rotates the refresh token on every use.
create table zalo_tokens (
  tenant_id uuid primary key default app_current_tenant() references tenants(id),
  access_token_sealed bytea not null,                      -- sealSecret(token, key)
  refresh_token_sealed bytea not null,
  access_expires_at timestamptz not null,
  needs_reconnect boolean not null default false,          -- refresh failed: the spa must re-authorize the OA
  refresh_lease_until timestamptz,                          -- a refresh is in progress until then
  updated_at timestamptz not null default now()
);
alter table zalo_tokens enable row level security;
alter table zalo_tokens force row level security;
create policy tenant_isolation on zalo_tokens
  using (tenant_id = (select app_current_tenant()))
  with check (tenant_id = (select app_current_tenant()));
```

## 3. Email

**DNS for the sending domain** (use a subdomain per stream, e.g. `mail.example.vn` for transactional and `news.example.vn` for marketing):

| Record | Value | Notes |
|---|---|---|
| SPF | `v=spf1 include:<provider> -all` | Each subdomain needs its own |
| DKIM | Key from your email provider, 2048-bit | Google recommends 2048 bits |
| DMARC | `v=DMARC1; p=none; rua=mailto:dmarc@example.vn`, then `quarantine` once reports are clean | The From domain must align with SPF or DKIM |
| PTR | The sending IP's reverse DNS resolves back | Your provider handles this on shared IPs |

**Bulk sender rules.** Gmail (about 5,000+ messages a day to personal Gmail accounts), Yahoo and Outlook.com (5,000+ a day, enforced since 5 May 2025 with `550 5.7.515`) require:
- SPF, DKIM and DMARC (`p=none` at least), aligned with the From domain;
- a spam rate below 0.10%, never 0.30% or more;
- one-click unsubscribe (RFC 8058) on marketing mail, honored within 2 days. Transactional mail (receipts, OTPs, reservation confirmations) is exempt.

Gmail ramped up rejections of non-compliant mail in November 2025.

**Other email rules:**
- **Suppression list.** Stop sending to hard bounces at once, and treat a spam complaint as an unsubscribe.
- **Sending for many spas.** Send from your verified domain with the spa's name as the display name and its address as `Reply-To`. A spa that wants its own From domain must add the DKIM and SPF records you give it: sending "as" a domain without them fails DMARC.
- **Vietnamese law** (Decree 91/2020/NĐ-CP) for advertising email:
  - prior consent;
  - `[QC]` or `[AD]` at the start of the subject;
  - at most 3 per address per 24 hours;
  - an opt-out in every message.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant';

// Signed, per customer: anyone holding the link can unsubscribe that customer, nothing else
export function unsubscribeUrl(base: string, tenantId: string, customerId: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(`${tenantId}.${customerId}`).digest('base64url');
  return `${base}/v1/unsubscribe?t=${tenantId}&c=${customerId}&s=${sig}`;
}

function validSignature(t: string, c: string, s: string, secret: string): boolean {
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${c}`).digest('base64url'));
  const given = Buffer.from(s);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Headers for every marketing email (RFC 8058). Both must be covered by the DKIM signature,
// which your email provider does when you add them as normal headers.
export const oneClickHeaders = (url: string) => ({
  'List-Unsubscribe': `<${url}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
});

// POST /v1/unsubscribe?t=&c=&s=, sent by the mailbox provider. Don't require an exact body: RFC 8058's own
// example posts multipart/form-data, and application/x-www-form-urlencoded is allowed too. The signed URL
// plus the POST method is the check. GET only shows a confirm page whose button POSTs: link scanners open
// (GET) every URL in an email, and must not unsubscribe anyone.
export async function handleOneClickUnsubscribe(
  pool: Pool,
  req: { method: string; query: { t?: string; c?: string; s?: string } },
  secret: string,
): Promise<{ status: number }> {
  const { t = '', c = '', s = '' } = req.query;
  if (!validSignature(t, c, s, secret)) return { status: 404 };
  if (req.method !== 'POST') return { status: 405 }; // GET, HEAD: render the confirm page instead
  await withTenant(pool, t, async (db) => {
    // Withdrawal is a new consent row (references/privacy.md); skip if already withdrawn
    await db.query(
      `INSERT INTO consents (subject_id, purpose_id, purpose_version, granted, method, evidence)
       SELECT $1, 'marketing_email', p.version, false, 'web_form', '{"via": "list-unsubscribe-post"}'
         FROM (SELECT max(version) AS version FROM consent_purposes WHERE id = 'marketing_email') p
        WHERE NOT EXISTS (SELECT 1 FROM current_consents
                           WHERE subject_id = $1 AND purpose_id = 'marketing_email' AND NOT granted)`,
      [c],
    );
  });
  return { status: 200 }; // no redirect: RFC 8058 forbids it
}
```

Test the DNS from outside: `dig +short TXT mail.example.vn` and `dig +short TXT _dmarc.example.vn`, plus your provider's DKIM check. Then send to a Gmail account and read "Show original" for `spf=pass dkim=pass dmarc=pass`.

## 4. Zalo template messages (ZBS, formerly ZNS)

Since 1 January 2026, Zalo's ZNS, UID transaction and UID promotion messages are one product, **ZBS Template Message**. Sending by phone number works as before; the docs moved to zalo.solutions.

- **Prerequisites:**
  - a verified business Official Account (OA), linked to a funded ZBS account;
  - a Zalo App authorized for the OA (you must be admin of both);
  - templates approved by Zalo (about 1–3 working days). An approved template cannot be edited; submit a new one.
- **Who receives:**
  - a phone number linked to a Zalo account;
  - only people who have had a transaction with the business;
  - following the OA is not required.
- **Tags:**
  - tag 1: transaction (OTP, booking, payment);
  - tag 2: customer care;
  - tag 3: promotion. Any promotional content makes a template tag 3, with tighter frequency limits.
  - No links or phone numbers in the body: use CTA buttons.
- **Send.** `POST https://business.openapi.zalo.me/message/template` with header `access_token`. The body has:
  - `phone` in 84 format;
  - `template_id` and `template_data`;
  - `tracking_id`: up to 48 characters, no special characters.
- **Tokens:**
  - Store both sealed (`*_sealed bytea`, `sealSecret` with a key from the secret manager; `openSecret` the access token just before `sendZaloTemplate`): whoever holds a refresh token can message as the spa's OA for about 3 months. The example uses one key; to rotate keys, add a `key_version` column and a key ring (`references/app-security.md`, "Tenant secrets").
  - The access token lasts about 25 hours and the refresh token about 3 months (Zalo's guide); read `expires_in` from the response.
  - Each refresh returns a new pair and invalidates the old one (Zalo support answers), so there is one valid pair per OA and app.
  - Refresh from one place, as below. If the refresh token is lost or expired, the spa must re-authorize the OA.
- **Delivery receipts.** The `user_received_message` webhook carries `msg_id` and `tracking_id`. Since November 2024 Zalo delivers these webhooks only to allowed IPs; its notice concerns servers outside Vietnam, so check before hosting the receiver abroad.
- **Quota.** A new OA starts around 20,000 messages a day, re-rated daily on quality; keep complaints under 0.1% a day. Successful responses include `quota.remainingQuota`.
- **Error codes.** These come from Zalo's docs and support answers; check the current table:
  - `-124`: access token invalid;
  - `-108`: phone invalid;
  - `-118`: no Zalo account;
  - `-141`: user refused these messages;
  - `-133`: no sending at night (10 PM–6 AM);
  - `-115`: balance empty;
  - `-1121` to `-1124`: template parameter errors.

```ts
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant';
import { openSecret, sealSecret } from '../security/secret-box';

export type ZaloTokens = { access_token: string; refresh_token: string; expires_in: string | number };
// POST https://oauth.zaloapp.com/v4/oa/access_token (header secret_key; form app_id, refresh_token,
// grant_type=refresh_token). Injected so tests can use a fake Zalo.
export type ZaloRefresh = (refreshToken: string) => Promise<ZaloTokens>;

// 0912345678 / +84 912 345 678 -> 84912345678 (the format Zalo expects)
export function toZaloPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.startsWith('84') ? d : d.replace(/^0/, '84');
}

// Run from a scheduled job about every 20 hours (access tokens last about 25 hours) and when a send
// returns -124. Only one refresh may use a refresh token: a short lease claims it, so no transaction
// stays open during the HTTP call, and a second caller gets 'busy' instead of burning the token.
// key: the 32-byte key from the secret manager; tokens are stored sealed, never in plain text.
export async function refreshZaloToken(
  pool: Pool, tenantId: string, refresh: ZaloRefresh, key: Buffer,
): Promise<'refreshed' | 'busy'> {
  const claimed = await withTenant(pool, tenantId, async (db) =>
    (await db.query<{ refresh_token_sealed: Buffer }>(
      `UPDATE zalo_tokens SET refresh_lease_until = now() + interval '30 seconds'
        WHERE refresh_lease_until IS NULL OR refresh_lease_until < now()
        RETURNING refresh_token_sealed`)).rows[0]);
  if (!claimed) return 'busy';
  const old = claimed.refresh_token_sealed;   // also identifies the row version we claimed
  const refreshToken = openSecret(old, key);
  let next: ZaloTokens;
  try {
    next = await refresh(refreshToken); // give this call a timeout shorter than the lease
  } catch (err) {
    // Expired (about 3 months unused) or revoked: the spa must reconnect its OA. Alert.
    await withTenant(pool, tenantId, (db) =>
      db.query('UPDATE zalo_tokens SET needs_reconnect = true, refresh_lease_until = NULL WHERE refresh_token_sealed = $1',
        [old]));
    throw err;
  }
  await withTenant(pool, tenantId, (db) =>
    db.query(
      `UPDATE zalo_tokens SET access_token_sealed = $2, refresh_token_sealed = $3, needs_reconnect = false,
              refresh_lease_until = NULL, access_expires_at = now() + make_interval(secs => $4::int), updated_at = now()
        WHERE refresh_token_sealed = $1`,
      [old, sealSecret(next.access_token, key), sealSecret(next.refresh_token, key), Number(next.expires_in)],
    ));
  return 'refreshed';
}

export type SendResult =
  | { ok: true; msgId: string }
  | { ok: false; next: 'retry_later' | 'refresh_token' | 'other_channel' | 'fail'; code: number; retryAt?: Date };

// POST https://business.openapi.zalo.me/message/template, header access_token
export async function sendZaloTemplate(
  fetchFn: typeof fetch,
  accessToken: string,
  m: { phone: string; templateId: string; data: Record<string, string>; notificationId: string; now?: Date },
): Promise<SendResult> {
  const res = await fetchFn('https://business.openapi.zalo.me/message/template', {
    method: 'POST',
    headers: { 'content-type': 'application/json', access_token: accessToken },
    body: JSON.stringify({
      phone: toZaloPhone(m.phone),
      template_id: m.templateId,
      template_data: m.data,
      tracking_id: m.notificationId.replace(/-/g, ''), // up to 48 characters, no special characters
    }),
  });
  const json = (await res.json()) as { error: number; data?: { msg_id: string } };
  if (json.error === 0 && json.data) return { ok: true, msgId: json.data.msg_id };
  switch (json.error) {
    case -124: return { ok: false, next: 'refresh_token', code: json.error }; // access token invalid or expired
    case -108: // phone number invalid
    case -118: // no Zalo account, or inactive
    case -141: return { ok: false, next: 'other_channel', code: json.error }; // user refused these messages
    case -133: return { ok: false, next: 'retry_later', code: json.error, retryAt: nextVietnamHour(6, m.now) }; // not at night
    case -115: return { ok: false, next: 'retry_later', code: json.error }; // ZBS balance empty: alert the spa
    default: return { ok: false, next: json.error <= -1121 && json.error >= -1124 ? 'fail' : 'retry_later', code: json.error };
  }
}

// Next time it is `hour`:00 in Vietnam (UTC+7)
export function nextVietnamHour(hour: number, now = new Date()): Date {
  const vn = new Date(now.getTime() + 7 * 3_600_000);
  const at = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate(), hour) - 7 * 3_600_000;
  return new Date(at > now.getTime() ? at : at + 86_400_000);
}
```

## 5. SMS brandname

- **Law.** Decree 91/2020/NĐ-CP on spam messages is still in force; a replacement drafted by the Ministry of Public Security was out for comment in September 2026. Since 1 March 2025 (Decree 02/2025), the brandname (tên định danh) and anti-spam work moved to the Ministry of Public Security. Fines are in Decree 330/2026/NĐ-CP (from 19 August 2026); check the text for current amounts.
- **Two kinds of brandname message:**
  - Customer care (CSKH): reminders and OTPs, using templates pre-registered with carriers, with no advertising content.
  - Advertising (QC) needs:
    - prior consent;
    - sending only 07:00–22:00;
    - at most 3 per number per advertiser per 24 hours;
    - opt-out instructions at the end of each message;
    - stopping at once on refusal, with one confirmation that contains no ads.
- **Encoding is cost.** Vietnamese diacritics force UCS-2: 70 characters per message instead of 160. Send SMS without diacritics (the `vibe-frontend` skill, `references/i18n.md`, has a remover that also handles đ), and count parts before sending.
- **Reserve, then send.** For each advertising message (any channel), the job runs `reserveAdvertisingSend` in its own `withTenant` transaction and commits, then calls the provider outside any transaction, then `finishAdvertisingSend`: `sent`, or deleted when the send failed for good (invalid number, no Zalo account). A timeout keeps the reservation: it counts, and the campaign is not resent to that customer. Counting first and writing the row after sending let two campaigns both see 2 sends and both send.

```ts
import type { PoolClient } from 'pg';
import { nextVietnamHour } from './zalo';

// GSM-7 fits 160 characters (153 per part when split); one character outside it (any Vietnamese
// diacritic) switches the whole message to UCS-2: 70 (67 per part). Carriers bill per part.
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';

export function smsParts(text: string): { encoding: 'GSM-7' | 'UCS-2'; parts: number } {
  const chars = [...text];
  if (chars.every((ch) => GSM.includes(ch) || GSM_EXT.includes(ch))) {
    const units = chars.reduce((n, ch) => n + (GSM_EXT.includes(ch) ? 2 : 1), 0);
    return { encoding: 'GSM-7', parts: units <= 160 ? 1 : Math.ceil(units / 153) };
  }
  const units = text.length; // UTF-16 code units
  return { encoding: 'UCS-2', parts: units <= 70 ? 1 : Math.ceil(units / 67) };
}

export type AdReservation =
  | { ok: true; messageId: string }
  | { ok: false; reason: 'no_consent' | 'quiet_hours' | 'daily_limit' | 'already_sent'; retryAt?: Date };

// Decree 91/2020/NĐ-CP: advertising messages only with prior consent, 07:00–22:00, and at most 3 per
// recipient per 24 hours. Checked at send time, not when the campaign is queued. Run it in its own short
// withTenant transaction, commit, then send: the reserved row counts from the start, and the lock makes two
// campaigns or workers checking the same customer and channel take turns, so both cannot see 2 and send.
export async function reserveAdvertisingSend(
  db: PoolClient,
  m: { customerId: string; channel: 'sms' | 'zalo' | 'email'; purposeId: string; campaignId: string; now?: Date },
): Promise<AdReservation> {
  const now = m.now ?? new Date();
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended(app_current_tenant()::text || ':' || $1 || ':' || $2, 0))`,
    [m.customerId, m.channel]); // released at commit
  const consent = await db.query(
    'SELECT 1 FROM current_consents WHERE subject_id = $1 AND purpose_id = $2 AND granted',
    [m.customerId, m.purposeId],
  );
  if (consent.rowCount === 0) return { ok: false, reason: 'no_consent' };
  const vnHour = new Date(now.getTime() + 7 * 3_600_000).getUTCHours();
  if (m.channel !== 'email' && (vnHour < 7 || vnHour >= 22)) {
    return { ok: false, reason: 'quiet_hours', retryAt: nextVietnamHour(7, now) };
  }
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM marketing_messages
      WHERE customer_id = $1 AND channel = $2 AND sent_at > $3::timestamptz - interval '24 hours'`,
    [m.customerId, m.channel, now],
  );
  if (rows[0]!.n >= 3) return { ok: false, reason: 'daily_limit' };
  const { rows: [row] } = await db.query<{ id: string }>(
    `INSERT INTO marketing_messages (customer_id, channel, campaign_id, sent_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, campaign_id, customer_id, channel) DO NOTHING RETURNING id`,
    [m.customerId, m.channel, m.campaignId, now],
  );
  return row ? { ok: true, messageId: row.id } : { ok: false, reason: 'already_sent' };
}

// After the provider answered: sent, or failed for good (the slot is free again). Outcome unknown
// (timeout): keep the reservation; it counts as sent, and the campaign is not resent to this customer.
export const finishAdvertisingSend = (db: PoolClient, messageId: string, sent: boolean) =>
  db.query(sent ? "UPDATE marketing_messages SET status = 'sent' WHERE id = $1" : 'DELETE FROM marketing_messages WHERE id = $1',
    [messageId]);
```

## 6. OTP abuse (SMS pumping)

Attackers request OTPs to numbers they earn money from, and you pay per message. On top of the OTP rules in `references/auth.md`:
- send only to Vietnamese mobile numbers (+84) unless you serve other countries;
- limit per phone number, IP and device;
- show a CAPTCHA past a threshold;
- watch the ratio of OTPs verified to OTPs sent, and alert when it drops (Twilio's guidance);
- make OTPs single-use, never logged, and regenerated on resend (OWASP).

## 7. Tests

The tests run on PostgreSQL as `app_user`, with fake providers:
- **Unsubscribe** (real HTTP requests to the handler):
  - a `multipart/form-data` POST (RFC 8058's example) withdraws `marketing_email`; a repeat as `application/x-www-form-urlencoded` adds no row; urlencoded alone works too;
  - a tampered link gives 404;
  - a GET (a link scanner) gives 405 and changes nothing;
  - other purposes stay granted.
- **Zalo tokens:**
  - three concurrent refreshes give `refreshed, busy, busy` and call Zalo once;
  - the newest pair is stored sealed (no plain text in the row, another key cannot open it) and the lease is released;
  - a revoked refresh token sets `needs_reconnect`.
- **Zalo send:**
  - `0912 345 678` is sent as `84912345678`, and `tracking_id` is the notification id without dashes;
  - `-124` means refresh the token, `-118` means another channel, and `-133` means retry at 06:00 Vietnam time.
- **Advertising reservation:**
  - allowed at 10:00;
  - blocked at 22:30 with `retryAt` 07:00;
  - blocked without consent;
  - blocked after 3 sends in 24 hours, and allowed again once the oldest send is 24 hours old;
  - blocked after the customer withdraws;
  - three campaigns reserving at once after 2 sends (a slow insert trigger widens the race): exactly one allowed;
  - the same campaign twice gives `already_sent`; a send that failed for good frees the slot.
- **SMS parts:**
  - the same reminder is 1 GSM-7 part without diacritics and 2 UCS-2 parts with them;
  - `{` counts as two characters.

Removing any one safeguard fails a test: the link signature, the POST check, the refresh lease, quiet hours, the daily limit, the consent check, the advisory lock, the reservation before sending.

## Done when

- [ ] SPF, DKIM (2048-bit) and DMARC pass for each sending subdomain; marketing mail has one-click unsubscribe; bounces and complaints are suppressed.
- [ ] Every message has a kind; consent, hours and the 3-per-24-hours limit are checked at send time for advertising, and the send is reserved under a per-customer lock before the provider call.
- [ ] Zalo templates are approved per tag; tokens are sealed and refresh from one place; `needs_reconnect` alerts the spa.
- [ ] Fallback to SMS only when Zalo cannot reach the person; SMS without diacritics; OTP sends are limited and monitored.

Sources:
- Email:
  - [Gmail sender guidelines](https://support.google.com/mail/answer/81126) and [FAQ](https://support.google.com/mail/answer/14229414);
  - [Yahoo sender best practices](https://senders.yahooinc.com/best-practices/);
  - [Outlook high-volume senders](https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730);
  - [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058).
- Zalo:
  - [ZBS Template Message notice](https://developers.zalo.me/changelog/thong-bao-ra-mat-zbs-template-message-va-lo-trinh-chuyen-doi-7814);
  - [send API guide](https://zalo.solutions/business-message/guidelines/en/gui-api);
  - [terms](https://zalo.solutions/terms);
  - [delivery webhook](https://developers.zalo.me/docs/zalo-notification-service/webhook/su-kien-nguoi-dung-nhan-thong-bao-zns).
- SMS and law:
  - [Decree 91/2020/NĐ-CP](https://thuvienphapluat.vn/van-ban/Cong-nghe-thong-tin/Nghi-dinh-91-2020-ND-CP-chong-tin-nhan-rac-thu-dien-tu-rac-cuoc-goi-rac-427854.aspx);
  - [transfer to the Ministry of Public Security](https://xaydungchinhsach.chinhphu.vn/ban-giao-nhiem-vu-bao-dam-an-toan-thong-tin-mang-giua-2-bo-11925022816531506.htm);
  - [Decree 330/2026/NĐ-CP](https://vanban.chinhphu.vn/?pageid=27160&docid=219266);
  - [Personal Data Protection Law 91/2025/QH15](https://thuvienphapluat.vn/van-ban/EN/Bo-may-hanh-chinh/Law-91-2025-QH15-Personal-Data-Protection/665440/tieng-anh.aspx), Article 28.
- OTP abuse: [Twilio on SMS pumping](https://www.twilio.com/docs/verify/preventing-toll-fraud), [OWASP MFA cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).
