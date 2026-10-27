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

// POST /v1/unsubscribe?t=&c=&s= with body "List-Unsubscribe=One-Click", sent by the mailbox provider.
// GET only shows a confirm page: link scanners open every URL in an email, and must not unsubscribe anyone.
export async function handleOneClickUnsubscribe(
  pool: Pool,
  query: { t?: string; c?: string; s?: string },
  body: string,
  secret: string,
): Promise<{ status: number }> {
  const { t = '', c = '', s = '' } = query;
  if (!validSignature(t, c, s, secret)) return { status: 404 };
  if (body.trim() !== 'List-Unsubscribe=One-Click') return { status: 400 };
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
