// auth.md section 7: HMAC over the raw body, timing-safe, with a replay window and rotation
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhook } from '../src/auth/webhook';

const body = Buffer.from('{"event":"payment.succeeded","amount":300000}');
const sign = (secret: string, t: number, raw = body) => createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex');
const now = 1_761_470_100_000;
const t = now / 1000;

describe('verifyWebhook', () => {
  it('accepts a fresh signature, also during secret rotation', () => {
    expect(verifyWebhook(body, `t=${t},v1=${sign('s1', t)}`, 's1', now)).toBe(true);
    expect(verifyWebhook(body, `t=${t},v1=${sign('old', t)},v1=${sign('s1', t)}`, 's1', now)).toBe(true);
  });

  it('rejects a changed body, a wrong secret, an old timestamp, garbage', () => {
    expect(verifyWebhook(Buffer.from('{"amount":3000}'), `t=${t},v1=${sign('s1', t)}`, 's1', now)).toBe(false);
    expect(verifyWebhook(body, `t=${t},v1=${sign('other', t)}`, 's1', now)).toBe(false);
    expect(verifyWebhook(body, `t=${t - 301},v1=${sign('s1', t - 301)}`, 's1', now)).toBe(false);
    expect(verifyWebhook(body, 'v1=abc', 's1', now)).toBe(false);
    expect(verifyWebhook(body, `t=${t},v1=zz`, 's1', now)).toBe(false);
  });
});
