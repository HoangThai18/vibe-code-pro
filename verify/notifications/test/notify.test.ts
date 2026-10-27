// test/notify.test.ts: DATABASE_URL=postgres://<superuser>@localhost/verify_notifications node --import tsx --test
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { withTenant } from '../src/db/tenant';
import { openSecret, sealSecret } from '../src/security/secret-box';
import { finishAdvertisingSend, reserveAdvertisingSend } from '../src/notify/sms';
import { handleOneClickUnsubscribe, oneClickHeaders, unsubscribeUrl } from '../src/notify/unsubscribe';
import { refreshZaloToken, sendZaloTemplate, type ZaloRefresh } from '../src/notify/zalo';

const url = process.env.DATABASE_URL!;
const admin = new pg.Pool({ connectionString: url });
const app = new pg.Pool({ connectionString: url, options: '-c role=app_user' });
const tenant = '00000000-0000-4000-8000-00000000000a';
const customer = '00000000-0000-4000-8000-0000000000c1';
const secret = 'unsubscribe-secret';
const KEY = randomBytes(32);   // from the secret manager in the app

before(async () => {
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  execFileSync('psql', [url, '-q', '-v', 'ON_ERROR_STOP=1', '-f', 'test/schema.sql', '-f', 'test/consents.sql', '-f', 'notify.sql']);
  await admin.query('GRANT USAGE ON SCHEMA public TO app_user; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user');
  await admin.query("INSERT INTO tenants (id, name) VALUES ($1, 'Spa A')", [tenant]);
  await admin.query("INSERT INTO customers (tenant_id, id, full_name, phone) VALUES ($1, $2, 'Nguyễn Thị Thảo', '0912345678')", [tenant, customer]);
  await admin.query(`INSERT INTO consent_purposes (id, version, text_vi) VALUES
    ('marketing_email', 1, 'Nhận email ưu đãi'), ('marketing_sms', 1, 'Nhận tin nhắn ưu đãi')`);
});
beforeEach(async () => {
  await admin.query('TRUNCATE consents, marketing_messages, zalo_tokens');
  await admin.query(`INSERT INTO consents (tenant_id, subject_id, purpose_id, purpose_version, granted, method)
    VALUES ($1, $2, 'marketing_email', 1, true, 'web_form'), ($1, $2, 'marketing_sms', 1, true, 'web_form')`, [tenant, customer]);
});
after(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const granted = async (purpose: string) => (await admin.query(
  'SELECT granted FROM current_consents WHERE subject_id = $1 AND purpose_id = $2', [customer, purpose])).rows[0]?.granted;

// The handler behind a real HTTP server, so requests arrive the way a mailbox provider sends them
async function unsubscribeServer() {
  const server = createServer(async (req, res) => {
    req.resume();                                            // the body is not needed
    const query = Object.fromEntries(new URL(req.url ?? '/', 'http://x').searchParams);
    const { status } = await handleOneClickUnsubscribe(app, { method: req.method ?? 'GET', query }, secret);
    res.writeHead(status).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

test('one-click unsubscribe: a POST withdraws consent once, multipart or urlencoded; GET and bad links do nothing', async () => {
  const srv = await unsubscribeServer();
  try {
    const link = new URL(unsubscribeUrl(srv.base, tenant, customer, secret));
    assert.deepEqual(oneClickHeaders(link.href), {
      'List-Unsubscribe': `<${link.href}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    const tampered = new URL(link); tampered.searchParams.set('c', tenant);
    const multipart = new FormData(); multipart.set('List-Unsubscribe', 'One-Click');   // RFC 8058's example
    assert.equal((await fetch(tampered, { method: 'POST', body: multipart })).status, 404);
    assert.equal((await fetch(link)).status, 405);                                     // a GET or a link scanner
    assert.equal(await granted('marketing_email'), true);
    assert.equal((await fetch(link, { method: 'POST', body: multipart })).status, 200);
    assert.equal((await fetch(link, { method: 'POST', body: new URLSearchParams({ 'List-Unsubscribe': 'One-Click' }) })).status, 200);
    assert.equal(await granted('marketing_email'), false);
    assert.equal(await granted('marketing_sms'), true);                                // other purposes untouched
    assert.equal(Number((await admin.query('SELECT count(*) FROM consents')).rows[0].count), 3); // the repeat added no row
  } finally {
    srv.close();
  }
});

test('urlencoded POST alone also unsubscribes', async () => {
  const srv = await unsubscribeServer();
  try {
    const link = unsubscribeUrl(srv.base, tenant, customer, secret);
    const body = new URLSearchParams({ 'List-Unsubscribe': 'One-Click' });
    assert.equal((await fetch(link, { method: 'POST', body })).status, 200);
    assert.equal(await granted('marketing_email'), false);
  } finally {
    srv.close();
  }
});

// A fake Zalo that rotates refresh tokens and rejects any token used twice
function fakeZalo() {
  let valid = 'rt-0';
  let n = 0;
  const refresh: ZaloRefresh = async (rt) => {
    if (rt !== valid) throw new Error('-14014 invalid refresh token');
    n += 1;
    valid = `rt-${n}`;
    await new Promise((r) => setTimeout(r, 50)); // network
    return { access_token: `at-${n}`, refresh_token: valid, expires_in: '90000' };
  };
  return { refresh, calls: () => n, revoke: () => { valid = 'revoked'; } };
}

const insertTokens = () => admin.query(
  'INSERT INTO zalo_tokens (tenant_id, access_token_sealed, refresh_token_sealed, access_expires_at) VALUES ($1, $2, $3, now())',
  [tenant, sealSecret('at-0', KEY), sealSecret('rt-0', KEY)]);

test('concurrent refreshes use the refresh token once and keep the newest pair, sealed', async () => {
  await insertTokens();
  const zalo = fakeZalo();
  const results = await Promise.all([1, 2, 3].map(() => refreshZaloToken(app, tenant, zalo.refresh, KEY)));
  assert.deepEqual(results.sort(), ['busy', 'busy', 'refreshed']);
  assert.equal(zalo.calls(), 1);
  const row = (await admin.query('SELECT access_token_sealed, refresh_token_sealed, needs_reconnect, refresh_lease_until FROM zalo_tokens')).rows[0];
  assert.deepEqual([openSecret(row.access_token_sealed, KEY), openSecret(row.refresh_token_sealed, KEY), row.needs_reconnect,
    row.refresh_lease_until], ['at-1', 'rt-1', false, null]);
  assert.ok(!row.refresh_token_sealed.includes('rt-1'));                      // no plain text in the database
  assert.throws(() => openSecret(row.refresh_token_sealed, randomBytes(32)));  // a dump without the key reveals nothing
  assert.equal(await refreshZaloToken(app, tenant, zalo.refresh, KEY), 'refreshed'); // the lease was released
});

test('a revoked or expired refresh token flags the OA for reconnecting', async () => {
  await insertTokens();
  const zalo = fakeZalo();
  zalo.revoke();
  await assert.rejects(refreshZaloToken(app, tenant, zalo.refresh, KEY), /invalid refresh token/);
  assert.equal((await admin.query('SELECT needs_reconnect FROM zalo_tokens')).rows[0].needs_reconnect, true);
});

test('Zalo send: phone in 84 format, errors mapped to what the job does next', async () => {
  const sent: { body: Record<string, unknown>; token: string }[] = [];
  const reply = (error: number) => (async (_: unknown, init?: RequestInit) => {
    sent.push({ body: JSON.parse(String(init!.body)), token: String((init!.headers as Record<string, string>).access_token) });
    return Response.json(error === 0 ? { error: 0, message: 'Success', data: { msg_id: 'm-1' } } : { error, message: 'x' });
  }) as typeof fetch;
  const msg = { phone: '0912 345 678', templateId: '301234', data: { ten: 'Thảo', gio: '10:30' },
    notificationId: '7d1f8a2e-1c3b-4e5f-9a7b-1234567890ab', now: new Date('2026-10-26T16:00:00Z') }; // 23:00 in Vietnam
  assert.deepEqual(await sendZaloTemplate(reply(0), 'at-1', msg), { ok: true, msgId: 'm-1' });
  assert.deepEqual(sent[0], { token: 'at-1', body: { phone: '84912345678', template_id: '301234',
    template_data: { ten: 'Thảo', gio: '10:30' }, tracking_id: '7d1f8a2e1c3b4e5f9a7b1234567890ab' } });
  assert.equal((await sendZaloTemplate(reply(-124), 'at-1', msg) as { next: string }).next, 'refresh_token');
  assert.equal((await sendZaloTemplate(reply(-118), 'at-1', msg) as { next: string }).next, 'other_channel');
  const night = await sendZaloTemplate(reply(-133), 'at-1', msg);
  assert.deepEqual(night, { ok: false, next: 'retry_later', code: -133, retryAt: new Date('2026-10-26T23:00:00Z') }); // 06:00 VN
});

const campaign = () => randomUUID();
const reserve = (now: string, o: { purposeId?: string; campaignId?: string } = {}) => withTenant(app, tenant, (db) =>
  reserveAdvertisingSend(db, { customerId: customer, channel: 'sms', purposeId: o.purposeId ?? 'marketing_sms',
    campaignId: o.campaignId ?? campaign(), now: new Date(now) }));
const sentBefore = (n: number) => admin.query(`INSERT INTO marketing_messages (tenant_id, customer_id, channel, campaign_id, status, sent_at)
  SELECT $1, $2, 'sms', gen_random_uuid(), 'sent', '2026-10-25T05:00:00Z'::timestamptz + k * interval '1 hour' FROM generate_series(1, $3) k`,
  [tenant, customer, n]);

test('advertising: consent, 07:00-22:00 Vietnam time, at most 3 per 24 hours', async () => {
  const ok = await reserve('2026-10-26T03:00:00Z');                                 // 10:00 VN
  assert.equal(ok.ok, true);
  await admin.query('TRUNCATE marketing_messages');
  assert.deepEqual(await reserve('2026-10-26T15:30:00Z'), { ok: false, reason: 'quiet_hours', retryAt: new Date('2026-10-27T00:00:00Z') });
  assert.deepEqual(await reserve('2026-10-26T03:00:00Z', { purposeId: 'marketing_zalo' }), { ok: false, reason: 'no_consent' });
  await sentBefore(3);
  assert.deepEqual(await reserve('2026-10-26T03:00:00Z'), { ok: false, reason: 'daily_limit' });
  assert.equal((await reserve('2026-10-26T08:30:00Z')).ok, true);                  // the oldest one is now over 24 hours ago
  await admin.query(`INSERT INTO consents (tenant_id, subject_id, purpose_id, purpose_version, granted, method)
    VALUES ($1, $2, 'marketing_sms', 1, false, 'sms')`, [tenant, customer]); // replied TU CHOI
  assert.deepEqual(await reserve('2026-10-26T08:30:00Z'), { ok: false, reason: 'no_consent' });
});

test('three campaigns checking at once after 2 sends: exactly one is allowed', async () => {
  await sentBefore(2);
  // A slow insert: without the lock, all three would count 2 before any reservation commits
  await admin.query(`CREATE FUNCTION slow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.2); RETURN NEW; END $$;
    CREATE TRIGGER slow BEFORE INSERT ON marketing_messages FOR EACH ROW EXECUTE FUNCTION slow()`);
  try {
    const results = await Promise.all([1, 2, 3].map(() => reserve('2026-10-26T03:00:00Z')));
    assert.deepEqual(results.map((r) => r.ok).sort(), [false, false, true]);
  } finally {
    await admin.query('DROP TRIGGER slow ON marketing_messages; DROP FUNCTION slow()');
  }
});

test('a campaign reserves once per customer and channel; a send that failed for good frees it', async () => {
  const id = campaign();
  const first = await reserve('2026-10-26T03:00:00Z', { campaignId: id });
  assert.equal(first.ok, true);
  assert.deepEqual(await reserve('2026-10-26T03:00:00Z', { campaignId: id }), { ok: false, reason: 'already_sent' }); // a retried job
  await withTenant(app, tenant, (db) => finishAdvertisingSend(db, (first as { messageId: string }).messageId, false)); // invalid number
  const second = await reserve('2026-10-26T03:00:00Z', { campaignId: id });
  assert.equal(second.ok, true);
  await withTenant(app, tenant, (db) => finishAdvertisingSend(db, (second as { messageId: string }).messageId, true));
  assert.deepEqual((await admin.query('SELECT status FROM marketing_messages')).rows, [{ status: 'sent' }]);
});
