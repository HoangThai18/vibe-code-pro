// test/bank-transfer.test.ts: DATABASE_URL=postgres://<superuser>@localhost/payments_check_bank node --import tsx --test
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { handleSepayWebhook, type SepayTransfer } from '../src/payments/bank-transfer';
import type { Paid } from '../src/payments/vnpay-ipn';

const url = process.env.DATABASE_URL!;
const admin = new pg.Pool({ connectionString: url });
const app = new pg.Pool({ connectionString: url, options: '-c role=app_user' });
const tenantA = '00000000-0000-4000-8000-00000000000a';
const tenantB = '00000000-0000-4000-8000-00000000000b';
const keys: Record<string, string> = { [tenantA]: 'key-a', [tenantB]: 'key-b' };
const getApiKey = async (t: string) => keys[t] ?? null;
const confirm = async (db: pg.PoolClient, p: Paid) => {
  await db.query('INSERT INTO confirmations (tenant_id, payment_id) VALUES ($1, $2)', [p.tenantId, p.paymentId]);
};
let refA = '';
let refB = '';
let nextId = 1;

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
     SELECT $1, id, 'bank_transfer', 300000, now() + interval '1 day' FROM a RETURNING ref`, [t])).rows[0].ref as string;
  refA = await ins(tenantA);
  refB = await ins(tenantB);
});
after(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const transfer = (over: Partial<SepayTransfer>): SepayTransfer => ({
  id: nextId++, gateway: 'Vietcombank', transactionDate: '2026-10-26 10:15:00', accountNumber: '0071000123456',
  code: null, content: `NGUYEN THI THAO chuyen tien SPA${refA}`, transferType: 'in', transferAmount: 300000,
  referenceCode: 'FT26299', description: '', ...over,
});
const send = (t: string, body: SepayTransfer, key = keys[t]) =>
  handleSepayWebhook(app, t, `Apikey ${key}`, body, getApiKey, confirm);
const status = async (ref: string) =>
  (await admin.query('SELECT status FROM payments WHERE ref = $1', [ref])).rows[0].status as string;
const outcomes = async () =>
  (await admin.query('SELECT outcome FROM payment_events ORDER BY id')).rows.map((r) => r.outcome as string);
const confirmations = async () => Number((await admin.query('SELECT count(*) FROM confirmations')).rows[0].count);

test('matching code and amount: paid; a retried delivery changes nothing', async () => {
  const body = transfer({ content: `chuyen khoan spa${refA} dat coc` }); // customers change case and add text
  assert.equal((await send(tenantA, body)).status, 200);
  assert.equal((await send(tenantA, body)).status, 200);
  assert.equal(await status(refA), 'paid');
  assert.equal(await confirmations(), 1);
  assert.deepEqual(await outcomes(), ['paid']);
});

test('wrong API key: 401, nothing recorded', async () => {
  assert.equal((await send(tenantA, transfer({}), 'key-b')).status, 401);
  assert.deepEqual(await outcomes(), []);
});

test('partial payment goes to review, never auto-confirmed', async () => {
  await send(tenantA, transfer({ transferAmount: 150000 }));
  assert.equal(await status(refA), 'needs_review');
  assert.equal(await confirmations(), 0);
});

test('no code, or a code from another spa: kept as unmatched', async () => {
  await send(tenantA, transfer({ content: 'THAO CK' }));
  await send(tenantA, transfer({ content: `SPA${refB}` }));
  assert.deepEqual(await outcomes(), ['unmatched', 'unmatched']);
  assert.equal(await status(refB), 'pending');
});

test('a second transfer for a paid payment is flagged, and money going out is ignored', async () => {
  await send(tenantA, transfer({}));
  await send(tenantA, transfer({}));
  await send(tenantA, transfer({ transferType: 'out' }));
  assert.deepEqual(await outcomes(), ['paid', 'already_settled']);
  assert.equal(await confirmations(), 1);
});
