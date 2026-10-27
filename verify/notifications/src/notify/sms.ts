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
