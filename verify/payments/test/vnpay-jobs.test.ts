// test/vnpay-jobs.test.ts: the expiry/reconciliation job and refunds, against a fake VNPay
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { withTenant } from '../src/db/tenant';
import { requestRefund, sendVnpayRefund } from '../src/payments/refunds';
import { reconcileVnpay, type VnpApi } from '../src/payments/vnpay-reconcile';
import { admin, app, count, getMerchant, hooks, insertPayment, merchant, resetDb, status, tenantA, tenantB, truncate } from './helpers';

const IP = '10.0.0.1';
const STAFF = '00000000-0000-4000-8000-0000000000e1';

before(resetDb);
beforeEach(truncate);
after(async () => {
  await Promise.all([admin.end(), app.end()]);
});

test('reconciliation lists tenants with app_tenant_ids() and asks VNPay before expiring', async () => {
  // The reason for app_tenant_ids(): the app role sees no tenants without a tenant context
  assert.equal((await app.query('SELECT id FROM tenants')).rowCount, 0);
  const late = await insertPayment(tenantA, 'vnpay', 200000, { expires: '-1 minute' });     // paid, IPN lost
  const never = await insertPayment(tenantA, 'vnpay', 200000, { expires: '-1 minute' });    // never reached VNPay
  const flagged = await insertPayment(tenantB, 'vnpay', 200000, { expires: '-1 minute' });  // 07
  const down = await insertPayment(tenantB, 'vnpay', 200000, { expires: '-1 minute' });     // querydr error
  const fresh = await insertPayment(tenantB, 'vnpay', 200000);                               // not expired yet
  const answers: Record<string, Record<string, string>> = {
    [late.ref]: { vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: '14567890' },
    [never.ref]: { vnp_ResponseCode: '91' },
    [flagged.ref]: { vnp_ResponseCode: '00', vnp_TransactionStatus: '07', vnp_TransactionNo: '14567891' },
    [down.ref]: { vnp_ResponseCode: '99' },
  };
  const asked: string[] = [];
  const call: VnpApi = async (body) => {
    asked.push(body.vnp_TxnRef!);
    return { vnp_Amount: '20000000', ...answers[body.vnp_TxnRef!] };
  };
  assert.equal(await reconcileVnpay(app, getMerchant, call, hooks, IP), 3);
  assert.deepEqual([await status(late.id), await status(never.id), await status(flagged.id), await status(down.id), await status(fresh.id)],
    ['paid', 'expired', 'needs_review', 'pending', 'pending']);
  assert.ok(!asked.includes(fresh.ref));
  assert.deepEqual([await count('confirmations'), await count('reviews')], [1, 1]);

  answers[flagged.ref] = { vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: '14567891' }; // approved
  await reconcileVnpay(app, getMerchant, call, hooks, IP);
  assert.equal(await status(flagged.id), 'paid');
});

// A fake VNPay refund API. Like VNPay, it refuses a repeated vnp_RequestId within the same day (Vietnam time)
// and treats it as a new request on another day.
function fakeVnpay() {
  const refunds: { requestId: string; day: string; amount: number }[] = [];
  const calls: string[] = [];
  let next: 'ok' | 'lose_reply' | 'unreachable' | 'reject' = 'ok';
  const call: VnpApi = async (body): Promise<Record<string, string>> => {
    calls.push(body.vnp_Command!);
    if (body.vnp_Command === 'querydr') {
      return { vnp_ResponseCode: '00', vnp_TransactionType: refunds.length ? '03' : '01',
        vnp_TransactionStatus: refunds.length ? '05' : '00', vnp_TransactionNo: '14567890' };
    }
    const mode = next;
    next = 'ok';
    if (mode === 'unreachable') throw new Error('ECONNRESET');
    if (mode === 'reject') return { vnp_ResponseCode: '95' };
    const day = body.vnp_CreateDate!.slice(0, 8);
    if (refunds.some((r) => r.requestId === body.vnp_RequestId && r.day === day)) return { vnp_ResponseCode: '94' };
    refunds.push({ requestId: body.vnp_RequestId!, day, amount: Number(body.vnp_Amount) / 100 });
    if (mode === 'lose_reply') throw new Error('ETIMEDOUT'); // refunded, but the reply never arrived
    return { vnp_ResponseCode: '00', vnp_TransactionNo: '14567999' };
  };
  return { call, refunds, calls, fail: (mode: typeof next) => { next = mode; } };
}

async function paidPayment() {
  const p = await insertPayment(tenantA, 'vnpay', 200000);
  await admin.query("UPDATE payments SET status = 'paid', paid_at = now(), provider_txn_id = '14567890' WHERE id = $1", [p.id]);
  return p;
}
const ask = (paymentId: string, amount: number) =>
  withTenant(app, tenantA, (db) => requestRefund(db, { paymentId, amount, requestedBy: STAFF }));
const refundStatus = async (id: string) => (await admin.query('SELECT status FROM refunds WHERE id = $1', [id])).rows[0].status;
const later = () => admin.query("UPDATE refunds SET sent_at = sent_at - interval '10 minutes'"); // the queue retries later

test('refund reply lost, retried after midnight: VNPay is asked first and refunds once', async () => {
  const vn = fakeVnpay();
  const refundId = (await ask((await paidPayment()).id, 50000))!;
  const job = { tenantId: tenantA, refundId };
  vn.fail('lose_reply');
  await assert.rejects(sendVnpayRefund(app, job, merchant(tenantA), vn.call, IP, new Date('2026-10-27T16:58:00Z')), /ETIMEDOUT/); // 23:58
  assert.equal(await refundStatus(refundId), 'sending');
  await later();
  // 00:08 the next day in Vietnam: the same vnp_RequestId would now be accepted as a new refund
  assert.equal(await sendVnpayRefund(app, job, merchant(tenantA), vn.call, IP, new Date('2026-10-27T17:08:00Z')), 'succeeded');
  assert.equal(vn.refunds.length, 1);
  assert.deepEqual(vn.calls, ['refund', 'querydr']);
  assert.match(vn.refunds[0]!.requestId, /^[0-9a-f]{32}$/);               // the refund id without dashes
  assert.equal(await sendVnpayRefund(app, job, merchant(tenantA), vn.call, IP), 'done');
});

test('refund that never reached VNPay: the retry finds no refund and sends it', async () => {
  const vn = fakeVnpay();
  const refundId = (await ask((await paidPayment()).id, 200000))!;
  vn.fail('unreachable');
  await assert.rejects(sendVnpayRefund(app, { tenantId: tenantA, refundId }, merchant(tenantA), vn.call, IP), /ECONNRESET/);
  await later();
  assert.equal(await sendVnpayRefund(app, { tenantId: tenantA, refundId }, merchant(tenantA), vn.call, IP), 'succeeded');
  assert.deepEqual([vn.refunds.length, vn.calls], [1, ['refund', 'querydr', 'refund']]);
});

test('an attempt still in flight is not sent again; a refused refund is marked failed', async () => {
  const vn = fakeVnpay();
  const p = await paidPayment();
  const first = (await ask(p.id, 50000))!;
  vn.fail('unreachable');
  await assert.rejects(sendVnpayRefund(app, { tenantId: tenantA, refundId: first }, merchant(tenantA), vn.call, IP));
  await assert.rejects(sendVnpayRefund(app, { tenantId: tenantA, refundId: first }, merchant(tenantA), vn.call, IP), /in flight/);
  assert.deepEqual(vn.calls, ['refund']);
  const second = (await ask(p.id, 50000))!;
  vn.fail('reject');
  assert.equal(await sendVnpayRefund(app, { tenantId: tenantA, refundId: second }, merchant(tenantA), vn.call, IP), 'failed');
});

test('refunds never exceed the payment, even when two staff refund at once', async () => {
  const p = await paidPayment();
  // A slow insert: without the payment lock both requests would add up the refunds before either commits
  await admin.query(`CREATE FUNCTION slow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.2); RETURN NEW; END $$;
    CREATE TRIGGER slow BEFORE INSERT ON refunds FOR EACH ROW EXECUTE FUNCTION slow()`);
  try {
    const ids = await Promise.all([ask(p.id, 150000), ask(p.id, 150000)]);
    assert.equal(ids.filter(Boolean).length, 1);
  } finally {
    await admin.query('DROP TRIGGER slow ON refunds; DROP FUNCTION slow()');
  }
  assert.ok(await ask(p.id, 50000));
  assert.equal(await ask(p.id, 1), null);
  const other = await insertPayment(tenantB, 'vnpay', 200000);                // another spa's payment: not found
  assert.equal(await ask(other.id, 1), null);
});
