// test/bank-transfer.test.ts: DATABASE_URL=postgres://<superuser>@localhost/verify_payments node --import tsx --test
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { handleSepayWebhook, type SepayTransfer } from '../src/payments/bank-transfer';
import { admin, apiKeys, app, count, getApiKey, hooks, insertPayment, resetDb, status, tenantA, tenantB, truncate } from './helpers';

let payA = { id: '', ref: '' };
let payB = { id: '', ref: '' };
let nextId = 1;

before(resetDb);
beforeEach(async () => {
  await truncate();
  payA = await insertPayment(tenantA, 'bank_transfer', 300000, { ref: 'K7M1Q0XA7', expires: '1 day' }); // has a 1 and a 0
  payB = await insertPayment(tenantB, 'bank_transfer', 300000, { expires: '1 day' });
});
after(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const transfer = (over: Partial<SepayTransfer>): SepayTransfer => ({
  id: nextId++, gateway: 'Vietcombank', transactionDate: '2026-10-26 10:15:00', accountNumber: '0071000123456',
  code: null, content: `NGUYEN THI THAO chuyen tien SPA${payA.ref}`, transferType: 'in', transferAmount: 300000,
  referenceCode: 'FT26299', description: '', ...over,
});
const send = (t: string, body: SepayTransfer, key = apiKeys[t]) =>
  handleSepayWebhook(app, t, `Apikey ${key}`, body, getApiKey, hooks);
const outcomes = async () =>
  (await admin.query('SELECT outcome FROM payment_events ORDER BY id')).rows.map((r) => r.outcome as string);

test('matching code and amount: paid; a retried delivery changes nothing', async () => {
  const body = transfer({ content: 'chuyen khoan spa-k7mlqoxa7 dat coc' }); // lower case, a dash, l and o for 1 and 0
  assert.equal((await send(tenantA, body)).status, 200);
  assert.equal((await send(tenantA, body)).status, 200);
  assert.equal(await status(payA.id), 'paid');
  assert.equal(await count('confirmations'), 1);
  assert.deepEqual(await outcomes(), ['paid']);
});

test('wrong API key: 401, nothing recorded', async () => {
  assert.equal((await send(tenantA, transfer({}), 'key-b')).status, 401);
  assert.deepEqual(await outcomes(), []);
});

test('partial payment goes to review with an alert, never auto-confirmed', async () => {
  await send(tenantA, transfer({ transferAmount: 150000 }));
  assert.equal(await status(payA.id), 'needs_review');
  assert.deepEqual([await count('confirmations'), await count('reviews')], [0, 1]);
});

test('a mistyped or swapped code never pays a deposit: unmatched, both payments stay pending', async () => {
  // Another pending deposit with the same amount, one typo away. Valid codes are never this close: the row
  // stands for what a sequence (SPA1042, SPA1043) or a code without a check character allows.
  const near = await insertPayment(tenantA, 'bank_transfer', 300000, { ref: 'K7M1Q0XB7', expires: '1 day' });
  for (const typed of ['K7M1Q0XB7', 'K7M1Q0AX7', 'K7M1Q0XA', 'K7M1Q0XA77']) {    // typo, swap, too short, too long
    await send(tenantA, transfer({ content: `chuyen tien SPA${typed}` }));
  }
  assert.deepEqual(await outcomes(), ['unmatched', 'unmatched', 'unmatched', 'unmatched']);
  assert.deepEqual([await status(payA.id), await status(near.id)], ['pending', 'pending']);
});

test('no code, or a code from another spa: kept as unmatched', async () => {
  await send(tenantA, transfer({ content: 'THAO CK' }));
  await send(tenantA, transfer({ content: `SPA${payB.ref}` }));
  assert.deepEqual(await outcomes(), ['unmatched', 'unmatched']);
  assert.equal(await status(payB.id), 'pending');
});

test('a second transfer for a paid payment is flagged, and money going out is ignored', async () => {
  await send(tenantA, transfer({}));
  await send(tenantA, transfer({}));
  await send(tenantA, transfer({ transferType: 'out' }));
  assert.deepEqual(await outcomes(), ['paid', 'already_settled']);
  assert.equal(await count('confirmations'), 1);
});

test('the same code may exist in two spas: unique per tenant', async () => {
  const twin = await insertPayment(tenantB, 'bank_transfer', 300000, { ref: payA.ref, expires: '1 day' });
  await send(tenantB, transfer({}));
  assert.deepEqual([await status(twin.id), await status(payA.id)], ['paid', 'pending']);
});
