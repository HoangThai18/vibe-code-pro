// test/notify.test.ts: DATABASE_URL=postgres://<superuser>@localhost/notify_check node --import tsx --test
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { withTenant } from '../src/db/tenant';
import { checkAdvertisingSend } from '../src/notify/sms';
import { handleOneClickUnsubscribe, oneClickHeaders, unsubscribeUrl } from '../src/notify/unsubscribe';
import { refreshZaloToken, sendZaloTemplate, type ZaloRefresh } from '../src/notify/zalo';

const url = process.env.DATABASE_URL!;
const admin = new pg.Pool({ connectionString: url });
const app = new pg.Pool({ connectionString: url, options: '-c role=app_user' });
const tenant = '00000000-0000-4000-8000-00000000000a';
const customer = '00000000-0000-4000-8000-0000000000c1';
const secret = 'unsubscribe-secret';

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

test('one-click unsubscribe: POST withdraws consent once; a bad link does nothing', async () => {
  const link = new URL(unsubscribeUrl('https://api.example.vn', tenant, customer, secret));
  const q = Object.fromEntries(link.searchParams);
  assert.deepEqual(oneClickHeaders(link.href), {
    'List-Unsubscribe': `<${link.href}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
  assert.equal((await handleOneClickUnsubscribe(app, { ...q, c: tenant }, 'List-Unsubscribe=One-Click', secret)).status, 404);
  assert.equal((await handleOneClickUnsubscribe(app, q, '', secret)).status, 400); // a GET or a scanner: no body
  assert.equal(await granted('marketing_email'), true);
  for (const _ of [1, 2]) {
    assert.equal((await handleOneClickUnsubscribe(app, q, 'List-Unsubscribe=One-Click', secret)).status, 200);
  }
  assert.equal(await granted('marketing_email'), false);
  assert.equal(await granted('marketing_sms'), true); // other purposes untouched
  assert.equal(Number((await admin.query('SELECT count(*) FROM consents')).rows[0].count), 3);
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

test('concurrent refreshes use the refresh token once and keep the newest pair', async () => {
  await admin.query("INSERT INTO zalo_tokens (tenant_id, access_token, refresh_token, access_expires_at) VALUES ($1, 'at-0', 'rt-0', now())", [tenant]);
  const zalo = fakeZalo();
  const results = await Promise.all([1, 2, 3].map(() => refreshZaloToken(app, tenant, zalo.refresh)));
  assert.deepEqual(results.sort(), ['busy', 'busy', 'refreshed']);
  assert.equal(zalo.calls(), 1);
  const row = (await admin.query('SELECT access_token, refresh_token, needs_reconnect, refresh_lease_until FROM zalo_tokens')).rows[0];
  assert.deepEqual(row, { access_token: 'at-1', refresh_token: 'rt-1', needs_reconnect: false, refresh_lease_until: null });
  assert.equal(await refreshZaloToken(app, tenant, zalo.refresh), 'refreshed'); // the lease was released
});

test('a revoked or expired refresh token flags the OA for reconnecting', async () => {
  await admin.query("INSERT INTO zalo_tokens (tenant_id, access_token, refresh_token, access_expires_at) VALUES ($1, 'at-0', 'rt-0', now())", [tenant]);
  const zalo = fakeZalo();
  zalo.revoke();
  await assert.rejects(refreshZaloToken(app, tenant, zalo.refresh), /invalid refresh token/);
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

test('advertising: consent, 07:00-22:00 Vietnam time, at most 3 per 24 hours', async () => {
  const check = (now: string, purposeId = 'marketing_sms') => withTenant(app, tenant, (db) =>
    checkAdvertisingSend(db, { customerId: customer, channel: 'sms', purposeId, now: new Date(now) }));
  assert.deepEqual(await check('2026-10-26T03:00:00Z'), { ok: true }); // 10:00 VN
  assert.deepEqual(await check('2026-10-26T15:30:00Z'), { ok: false, reason: 'quiet_hours', retryAt: new Date('2026-10-27T00:00:00Z') });
  assert.deepEqual(await check('2026-10-26T03:00:00Z', 'marketing_zalo'), { ok: false, reason: 'no_consent' });
  await admin.query(`INSERT INTO marketing_messages (tenant_id, customer_id, channel, campaign_id, sent_at)
    SELECT $1, $2, 'sms', gen_random_uuid(), '2026-10-25T05:00:00Z'::timestamptz + n * interval '1 hour' FROM generate_series(1, 3) n`,
    [tenant, customer]);
  assert.deepEqual(await check('2026-10-26T03:00:00Z'), { ok: false, reason: 'daily_limit' });
  assert.deepEqual(await check('2026-10-26T08:30:00Z'), { ok: true }); // the oldest one is now over 24 hours ago
  await admin.query(`INSERT INTO consents (tenant_id, subject_id, purpose_id, purpose_version, granted, method)
    VALUES ($1, $2, 'marketing_sms', 1, false, 'sms')`, [tenant, customer]); // replied TU CHOI
  assert.deepEqual(await check('2026-10-26T08:30:00Z'), { ok: false, reason: 'no_consent' });
});
