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
