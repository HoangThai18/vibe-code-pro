// test/vnpay.test.ts: DATABASE_URL=postgres://<superuser>@localhost/payments_check node --import tsx --test
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import qs from 'qs';
import { buildVnpayUrl, vnpDate, vnpHash, vnpOrderInfo, vnpRefundRequest, vnpSignData, vnpVerify, type VnpMerchant } from '../src/payments/vnpay';
import { handleVnpayIpn, type Paid } from '../src/payments/vnpay-ipn';

// sortObject copied from VNPay's official Node.js demo (routes/order.js)
function demoSortObject(obj: Record<string, string>) {
  const sorted: Record<string, string> = {};
  const str: string[] = [];
  for (const key in obj) if (Object.hasOwn(obj, key)) str.push(encodeURIComponent(key));
  str.sort();
  for (const k of str) sorted[k] = encodeURIComponent(obj[k]!).replace(/%20/g, '+');
  return sorted;
}

test('signs exactly like the official demo', () => {
  const params = {
    vnp_TxnRef: '1042', vnp_Amount: '20000000', vnp_OrderInfo: 'Dat coc lich hen 1042',
    vnp_ReturnUrl: 'https://spa.example.vn/t/abc/payments/return?x=1&y=a b', vnp_IpAddr: '::ffff:10.0.0.1',
    vnp_Locale: 'vn', vnp_BankCode: '', vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: 'DEMO1234',
  };
  assert.equal(vnpSignData(params), qs.stringify(demoSortObject(params), { encode: false }));
});

test('dates are Vietnam time whatever the server time zone', () => {
  assert.equal(vnpDate(new Date('2026-10-26T17:30:05Z')), '20261027003005');
});

test('order info has no diacritics or special characters', () => {
  assert.equal(vnpOrderInfo('Đặt cọc lịch hẹn #12 (Thảo), 200.000đ'), 'Dat coc lich hen 12 Thao 200 000d');
});

test('refund hash covers the fields joined with | in the demo order', () => {
  const m: VnpMerchant = { tmnCode: 'DEMO1234', hashSecret: 'secret', payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html' };
  const body = vnpRefundRequest(m, {
    requestId: 'r-1', type: '02', ref: '1042', amount: 200_000, transactionNo: '14567890',
    transactionDate: '20261026101500', createdBy: 'staff-7', ipAddr: '10.0.0.1', now: new Date('2026-10-27T03:00:00Z'),
  });
  const demo = [body.vnp_RequestId, '2.1.0', 'refund', 'DEMO1234', '02', '1042', '20000000', '14567890',
    '20261026101500', 'staff-7', '20261027100000', '10.0.0.1', 'Hoan tien 1042'].join('|');
  assert.equal(body.vnp_SecureHash, vnpHash(demo, 'secret'));
});

// ---- IPN against a real database, as the app role ----
const url = process.env.DATABASE_URL!;
const admin = new pg.Pool({ connectionString: url });
const app = new pg.Pool({ connectionString: url, options: '-c role=app_user' });
const tenantA = '00000000-0000-4000-8000-00000000000a';
const tenantB = '00000000-0000-4000-8000-00000000000b';
const merchants: Record<string, VnpMerchant> = {
  [tenantA]: { tmnCode: 'SPAA0001', hashSecret: 'secret-a', payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html' },
  [tenantB]: { tmnCode: 'SPAB0001', hashSecret: 'secret-b', payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html' },
};
const getMerchant = async (t: string) => merchants[t] ?? null;
const confirm = async (db: pg.PoolClient, p: Paid) => {
  await db.query('INSERT INTO confirmations (tenant_id, payment_id) VALUES ($1, $2)', [p.tenantId, p.paymentId]);
};
let refA = '';
let refB = '';

before(async () => {
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  execFileSync('psql', [url, '-q', '-v', 'ON_ERROR_STOP=1', '-f', 'test/schema.sql', '-f', 'payments.sql']);
  await admin.query('GRANT USAGE ON SCHEMA public TO app_user; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user');
  await admin.query("INSERT INTO tenants (id, name) VALUES ($1, 'Spa A'), ($2, 'Spa B')", [tenantA, tenantB]);
});
beforeEach(async () => {
  await admin.query('TRUNCATE confirmations, payment_events, payments, appointments');
  const ins = async (t: string) => (await admin.query(
    `WITH a AS (INSERT INTO appointments (tenant_id) VALUES ($1) RETURNING id)
     INSERT INTO payments (tenant_id, appointment_id, provider, amount, expires_at)
     SELECT $1, id, 'vnpay', 200000, now() + interval '15 minutes' FROM a RETURNING ref`, [t])).rows[0].ref as string;
  refA = await ins(tenantA);
  refB = await ins(tenantB);
});
after(async () => {
  await Promise.all([admin.end(), app.end()]);
});

// What VNPay sends to the IPN URL, signed with the merchant's secret
function ipn(m: VnpMerchant, over: Record<string, string>) {
  const q: Record<string, string> = {
    vnp_TmnCode: m.tmnCode, vnp_Amount: '20000000', vnp_BankCode: 'NCB', vnp_OrderInfo: 'Dat coc',
    vnp_PayDate: '20261026101500', vnp_ResponseCode: '00', vnp_TransactionStatus: '00',
    vnp_TransactionNo: '14567890', vnp_TxnRef: refA, ...over,
  };
  return { ...q, vnp_SecureHashType: 'HmacSHA512', vnp_SecureHash: vnpHash(vnpSignData(q), m.hashSecret).toUpperCase() };
}
const status = async (ref: string) =>
  (await admin.query('SELECT status FROM payments WHERE ref = $1', [ref])).rows[0].status as string;
const confirmations = async () => Number((await admin.query('SELECT count(*) FROM confirmations')).rows[0].count);

test('a payment URL verifies, and any change breaks it', () => {
  const link = new URL(buildVnpayUrl(merchants[tenantA]!, {
    ref: '1042', amount: 200_000, orderInfo: 'Đặt cọc', returnUrl: 'https://spa.example.vn/r', ipAddr: '10.0.0.1',
  }));
  const params = Object.fromEntries(link.searchParams);
  assert.equal(params.vnp_Amount, '20000000');
  assert.ok(vnpVerify(params, 'secret-a'));
  assert.ok(!vnpVerify({ ...params, vnp_Amount: '100' }, 'secret-a'));
});

test('two notifications for one payment at once: paid once, confirmed once', async () => {
  // Same IPN twice, plus one that is not a byte-for-byte copy (as a reconciliation job would race)
  const q = ipn(merchants[tenantA]!, {});
  const other = ipn(merchants[tenantA]!, { vnp_TransactionNo: '14567891' });
  const replies = await Promise.all([q, q, other].map((x) => handleVnpayIpn(app, tenantA, x, getMerchant, confirm)));
  assert.deepEqual(replies.map((r) => r.RspCode).sort(), ['00', '02', '02']);
  assert.equal(await status(refA), 'paid');
  assert.equal(await confirmations(), 1);
});

test('bad signature, wrong merchant or another spa secret: 97, nothing changes', async () => {
  const good = ipn(merchants[tenantA]!, {});
  for (const q of [{ ...good, vnp_Amount: '1000' }, ipn(merchants[tenantB]!, {}), { ...good, vnp_SecureHash: '' }]) {
    assert.equal((await handleVnpayIpn(app, tenantA, q, getMerchant, confirm)).RspCode, '97');
  }
  assert.equal(await status(refA), 'pending');
});

test('amount different from the payment row: 04', async () => {
  const reply = await handleVnpayIpn(app, tenantA, ipn(merchants[tenantA]!, { vnp_Amount: '100' }), getMerchant, confirm);
  assert.equal(reply.RspCode, '04');
  assert.equal(await status(refA), 'pending');
});

test("another spa's payment is not found, even with a valid signature", async () => {
  const reply = await handleVnpayIpn(app, tenantA, ipn(merchants[tenantA]!, { vnp_TxnRef: refB }), getMerchant, confirm);
  assert.equal(reply.RspCode, '01');
  assert.equal(await status(refB), 'pending');
});

test('cancelled, or ResponseCode 00 without TransactionStatus 00: recorded as failed, acknowledged', async () => {
  assert.equal((await handleVnpayIpn(app, tenantA, ipn(merchants[tenantA]!, { vnp_ResponseCode: '24', vnp_TransactionStatus: '02' }), getMerchant, confirm)).RspCode, '00');
  assert.equal(await status(refA), 'failed');
  const q = ipn(merchants[tenantB]!, { vnp_TxnRef: refB, vnp_TransactionStatus: '02' });  // ResponseCode stays '00'
  assert.equal((await handleVnpayIpn(app, tenantB, q, getMerchant, confirm)).RspCode, '00');
  assert.equal(await status(refB), 'failed');
  assert.equal(await confirmations(), 0);
});

test('if enqueueing the confirmation fails, the payment stays pending and VNPay retries', async () => {
  const failing = async () => { throw new Error('queue down'); };
  assert.equal((await handleVnpayIpn(app, tenantA, ipn(merchants[tenantA]!, {}), getMerchant, failing)).RspCode, '99');
  assert.equal(await status(refA), 'pending');
  assert.equal((await handleVnpayIpn(app, tenantA, ipn(merchants[tenantA]!, {}), getMerchant, confirm)).RspCode, '00');
  assert.equal(await confirmations(), 1);
});
