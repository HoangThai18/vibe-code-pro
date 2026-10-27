// test/vnpay.test.ts: DATABASE_URL=postgres://<superuser>@localhost/verify_payments node --import tsx --test
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import qs from 'qs';
import { buildVnpayUrl, vnpDate, vnpHash, vnpOrderInfo, vnpQueryRequest, vnpRefundRequest, vnpSignData, vnpVerify, type VnpMerchant } from '../src/payments/vnpay';
import { handleVnpayIpn } from '../src/payments/vnpay-ipn';
import { admin, app, count, getMerchant, hooks, insertPayment, KEY, merchant, resetDb, status, tenantA, tenantB, truncate } from './helpers';

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

test('refund and querydr hashes cover the fields joined with | in the demo order', () => {
  const m: VnpMerchant = { tmnCode: 'DEMO1234', hashSecret: 'secret', payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html' };
  const now = new Date('2026-10-27T03:00:00Z');
  const body = vnpRefundRequest(m, {
    requestId: 'r1', type: '02', ref: 'K7M2Q9XA4', amount: 200_000, transactionNo: '14567890',
    transactionDate: '20261026101500', createdBy: 'staff-7', ipAddr: '10.0.0.1', now,
  });
  const demo = ['r1', '2.1.0', 'refund', 'DEMO1234', '02', 'K7M2Q9XA4', '20000000', '14567890',
    '20261026101500', 'staff-7', '20261027100000', '10.0.0.1', 'Hoan tien K7M2Q9XA4'].join('|');
  assert.equal(body.vnp_SecureHash, vnpHash(demo, 'secret'));
  const query = vnpQueryRequest(m, { requestId: 'q1', ref: 'K7M2Q9XA4', transactionDate: '20261026101500', ipAddr: '10.0.0.1', now });
  const demoQuery = ['q1', '2.1.0', 'querydr', 'DEMO1234', 'K7M2Q9XA4', '20261026101500', '20261027100000', '10.0.0.1',
    'Truy van K7M2Q9XA4'].join('|');
  assert.equal(query.vnp_SecureHash, vnpHash(demoQuery, 'secret'));
});

// ---- IPN against a real database, as the app role ----
let payA = { id: '', ref: '' };
let payB = { id: '', ref: '' };

before(resetDb);
beforeEach(async () => {
  await truncate();
  payA = await insertPayment(tenantA, 'vnpay', 200000);
  payB = await insertPayment(tenantB, 'vnpay', 200000);
});
after(async () => {
  await Promise.all([admin.end(), app.end()]);
});

// What VNPay sends to the IPN URL, signed with the merchant's secret
function ipn(t: string, over: Record<string, string>) {
  const m = merchant(t);
  const q: Record<string, string> = {
    vnp_TmnCode: m.tmnCode, vnp_Amount: '20000000', vnp_BankCode: 'NCB', vnp_OrderInfo: 'Dat coc',
    vnp_PayDate: '20261026101500', vnp_ResponseCode: '00', vnp_TransactionStatus: '00',
    vnp_TransactionNo: '14567890', vnp_TxnRef: t === tenantA ? payA.ref : payB.ref, ...over,
  };
  return { ...q, vnp_SecureHashType: 'HmacSHA512', vnp_SecureHash: vnpHash(vnpSignData(q), m.hashSecret).toUpperCase() };
}
const send = (t: string, q: Record<string, string>, h = hooks) => handleVnpayIpn(app, t, q, getMerchant, h);

test('merchant credentials are sealed at rest and open only with the key', async () => {
  const { rows: [row] } = await admin.query("SELECT credentials_sealed FROM payment_accounts WHERE tenant_id = $1 AND provider = 'vnpay'", [tenantA]);
  assert.ok(!row.credentials_sealed.includes('secret-a'));
  assert.equal((await getMerchant(tenantA))?.hashSecret, 'secret-a');
  assert.ok(KEY.length === 32);
});

test('a payment URL verifies, and any change breaks it', () => {
  const link = new URL(buildVnpayUrl(merchant(tenantA), {
    ref: 'K7M2Q9XA4', amount: 200_000, orderInfo: 'Đặt cọc', returnUrl: 'https://spa.example.vn/r', ipAddr: '10.0.0.1',
  }));
  const params = Object.fromEntries(link.searchParams);
  assert.equal(params.vnp_Amount, '20000000');
  assert.ok(vnpVerify(params, 'secret-a'));
  assert.ok(!vnpVerify({ ...params, vnp_Amount: '100' }, 'secret-a'));
});

test('two notifications for one payment at once: paid once, confirmed once', async () => {
  // Same IPN twice, plus one that is not a byte-for-byte copy (as a reconciliation job would race)
  const q = ipn(tenantA, {});
  const other = ipn(tenantA, { vnp_TransactionNo: '14567891' });
  // A slow status update keeps the first delivery's transaction open, so the others read while it is in flight
  await admin.query(`CREATE FUNCTION slow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.3); RETURN NEW; END $$;
    CREATE TRIGGER slow BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION slow()`);
  let replies;
  try {
    replies = await Promise.all([q, q, other].map((x) => send(tenantA, x)));
  } finally {
    await admin.query('DROP TRIGGER slow ON payments; DROP FUNCTION slow()');
  }
  assert.deepEqual(replies.map((r) => r.RspCode).sort(), ['00', '02', '02']);
  assert.equal(await status(payA.id), 'paid');
  assert.equal(await count('confirmations'), 1);
});

test('bad signature, wrong merchant or another spa secret: 97, nothing changes', async () => {
  const good = ipn(tenantA, {});
  for (const q of [{ ...good, vnp_Amount: '1000' }, ipn(tenantB, {}), { ...good, vnp_SecureHash: '' }]) {
    assert.equal((await send(tenantA, q)).RspCode, '97');
  }
  assert.equal(await status(payA.id), 'pending');
});

test('amount different from the payment row: 04', async () => {
  assert.equal((await send(tenantA, ipn(tenantA, { vnp_Amount: '100' }))).RspCode, '04');
  assert.equal(await status(payA.id), 'pending');
});

test("another spa's payment is not found, even with a valid signature; a malformed ref too", async () => {
  assert.equal((await send(tenantA, ipn(tenantA, { vnp_TxnRef: payB.ref }))).RspCode, '01');
  assert.equal((await send(tenantA, ipn(tenantA, { vnp_TxnRef: '1042' }))).RspCode, '01');
  assert.equal(await status(payB.id), 'pending');
});

test('cancelled, or ResponseCode 00 without TransactionStatus 00: recorded as failed, acknowledged', async () => {
  assert.equal((await send(tenantA, ipn(tenantA, { vnp_ResponseCode: '24', vnp_TransactionStatus: '02' }))).RspCode, '00');
  assert.equal(await status(payA.id), 'failed');
  const q = ipn(tenantB, { vnp_TransactionStatus: '02' });  // ResponseCode stays '00'
  assert.equal((await send(tenantB, q)).RspCode, '00');
  assert.equal(await status(payB.id), 'failed');
  assert.equal(await count('confirmations'), 0);
});

test('07 (money taken, flagged as suspicious): needs_review and an alert; the later approval is recorded', async () => {
  assert.equal((await send(tenantA, ipn(tenantA, { vnp_ResponseCode: '07', vnp_TransactionStatus: '07' }))).RspCode, '00');
  assert.deepEqual([await status(payA.id), await count('reviews'), await count('confirmations')], ['needs_review', 1, 0]);
  assert.equal((await send(tenantA, ipn(tenantA, { vnp_ResponseCode: '07', vnp_TransactionStatus: '07' }))).RspCode, '02');
  assert.equal(await count('reviews'), 1);                       // a repeated 07 alerts once
  assert.equal((await send(tenantA, ipn(tenantA, {}))).RspCode, '00'); // approved in the merchant portal
  assert.deepEqual([await status(payA.id), await count('confirmations')], ['paid', 1]);
  // 07 in TransactionStatus alone counts too
  assert.equal((await send(tenantB, ipn(tenantB, { vnp_TransactionStatus: '07' }))).RspCode, '00');
  assert.equal(await status(payB.id), 'needs_review');
});

test('if enqueueing the confirmation fails, the payment stays pending and VNPay retries', async () => {
  const failing = { ...hooks, onPaid: async () => { throw new Error('queue down'); } };
  assert.equal((await send(tenantA, ipn(tenantA, {}), failing)).RspCode, '99');
  assert.equal(await status(payA.id), 'pending');
  assert.equal((await send(tenantA, ipn(tenantA, {}))).RspCode, '00');
  assert.equal(await count('confirmations'), 1);
});
