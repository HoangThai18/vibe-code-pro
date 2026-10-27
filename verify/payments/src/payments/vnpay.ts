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
