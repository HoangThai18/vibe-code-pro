import type { Pool } from 'pg';
import { withTenant } from '../db/tenant';

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
export async function refreshZaloToken(pool: Pool, tenantId: string, refresh: ZaloRefresh): Promise<'refreshed' | 'busy'> {
  const claimed = await withTenant(pool, tenantId, async (db) =>
    (await db.query<{ refresh_token: string }>(
      `UPDATE zalo_tokens SET refresh_lease_until = now() + interval '30 seconds'
        WHERE refresh_lease_until IS NULL OR refresh_lease_until < now()
        RETURNING refresh_token`)).rows[0]);
  if (!claimed) return 'busy';
  let next: ZaloTokens;
  try {
    next = await refresh(claimed.refresh_token); // give this call a timeout shorter than the lease
  } catch (err) {
    // Expired (about 3 months unused) or revoked: the spa must reconnect its OA. Alert.
    await withTenant(pool, tenantId, (db) =>
      db.query('UPDATE zalo_tokens SET needs_reconnect = true, refresh_lease_until = NULL WHERE refresh_token = $1',
        [claimed.refresh_token]));
    throw err;
  }
  await withTenant(pool, tenantId, (db) =>
    db.query(
      `UPDATE zalo_tokens SET access_token = $2, refresh_token = $3, needs_reconnect = false, refresh_lease_until = NULL,
              access_expires_at = now() + make_interval(secs => $4::int), updated_at = now()
        WHERE refresh_token = $1`,
      [claimed.refresh_token, next.access_token, next.refresh_token, Number(next.expires_in)],
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
