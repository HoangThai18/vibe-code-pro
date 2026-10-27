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
2. **Check consent, hours and limits at send time, in the job.** Don't check them when the campaign is queued: consent can be withdrawn in between (`references/privacy.md`).
3. **One notification id is the idempotency key** with every provider (Zalo `tracking_id`, the SMS provider's request id). A retried job never sends twice.
4. **Fallback only for "can't reach this person here".** Examples: no Zalo account, or the user refused Zalo messages. A provider outage is not one of them: retry later on the same channel. Record each attempt.
5. **Per-tenant identity and cost:**
   - each spa sends as itself (its Zalo OA, its brandname, its name in the email display name);
   - set a daily quota per tenant;
   - alert on a spending jump.
6. **Minimal content.** A reminder needs the first name, time and place, not the treatment or a health note.

```sql
{{notify.sql}}
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
{{src/notify/unsubscribe.ts}}
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
{{src/notify/zalo.ts}}
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

```ts
{{src/notify/sms.ts}}
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
- **Unsubscribe:**
  - a POST with `List-Unsubscribe=One-Click` withdraws `marketing_email` once, and repeating it adds no row;
  - a tampered link gives 404;
  - an empty body (a GET or a link scanner) gives 400;
  - other purposes stay granted.
- **Zalo tokens:**
  - three concurrent refreshes give `refreshed, busy, busy` and call Zalo once;
  - the newest pair is stored and the lease is released;
  - a revoked refresh token sets `needs_reconnect`.
- **Zalo send:**
  - `0912 345 678` is sent as `84912345678`, and `tracking_id` is the notification id without dashes;
  - `-124` means refresh the token, `-118` means another channel, and `-133` means retry at 06:00 Vietnam time.
- **Advertising check:**
  - allowed at 10:00;
  - blocked at 22:30 with `retryAt` 07:00;
  - blocked without consent;
  - blocked after 3 sends in 24 hours, and allowed again once the oldest send is 24 hours old;
  - blocked after the customer withdraws.
- **SMS parts:**
  - the same reminder is 1 GSM-7 part without diacritics and 2 UCS-2 parts with them;
  - `{` counts as two characters.

Each of these safeguards, removed alone, fails a test: the link signature, the body check, the refresh lease, quiet hours, the daily limit and the consent check.

## Done when

- [ ] SPF, DKIM (2048-bit) and DMARC pass for each sending subdomain; marketing mail has one-click unsubscribe; bounces and complaints are suppressed.
- [ ] Every message has a kind; consent, hours and the 3-per-24-hours limit are checked at send time for advertising.
- [ ] Zalo templates are approved per tag; tokens refresh from one place; `needs_reconnect` alerts the spa.
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
