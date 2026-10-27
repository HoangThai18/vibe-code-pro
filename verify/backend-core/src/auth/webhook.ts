// src/auth/webhook.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

// Example for header format "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${rawBody}`>[,v1=...]"
export function verifyWebhook(rawBody: Buffer, header: string, secret: string, nowMs = Date.now()): boolean {
  const pairs = header.split(',').map((kv) => kv.trim().split('=', 2));
  const t = Number(pairs.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > 300) return false;   // more than 5 minutes off
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  // During provider secret rotation the header has several v1 signatures: valid if any one matches
  return pairs.some(([k, v]) => {
    if (k !== 'v1' || !v) return false;
    const given = Buffer.from(v, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
