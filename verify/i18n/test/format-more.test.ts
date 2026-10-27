// Extra cases behind the claims in i18n.md (not shown in the doc)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { formatDateOnly, formatDateTime, formatMoney, parseVndInput } from '../src/i18n/format';

const at = new Date('2026-10-24T08:30:00Z');
const cps = (s: string) => [...s].map((c) => c.codePointAt(0)!.toString(16).padStart(4, '0')).join(' ');

test('code points of the VND output', () => {
  assert.equal(cps(formatMoney({ amount: 1_250_000, currency: 'VND' }, 'vi')), '0031 002e 0032 0035 0030 002e 0030 0030 0030 00a0 20ab');
  assert.equal(formatMoney({ amount: -50_000, currency: 'VND' }, 'vi'), '-50.000\u00a0₫');
  assert.equal(formatMoney({ amount: 0, currency: 'VND' }, 'vi'), '0\u00a0₫');
  assert.equal(formatMoney({ amount: 125_050, currency: 'USD' }, 'en'), '$1,250.50');
  // Without the integer guard Intl rounds silently
  assert.equal(new Intl.NumberFormat('vi', { style: 'currency', currency: 'VND' }).format(999.5), '1.000\u00a0₫');
});

test('plain spaces in date outputs (Node 22 / ICU 77.1)', () => {
  assert.equal(cps(formatDateTime(at, { locale: 'en', timeZone: 'Asia/Ho_Chi_Minh' })).includes('202f'), false);
  assert.equal(at.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }), '15:30 24/10/26');
  assert.equal(at.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium', timeStyle: 'short' }), '15:30 24 thg 10, 2026');
});

test('more typed amounts', () => {
  for (const s of ['1250000', '1.250.000đ', '1.250.000 vnđ', '1.250.000VND', '0']) assert.notEqual(parseVndInput(s), null, s);
  for (const s of ['1.25', '1.250,000', '', 'abc', '1..250', '99999999999999999999']) assert.equal(parseVndInput(s), null, s);
});

test('date-only: en and bad input', () => {
  assert.equal(formatDateOnly('2001-07-18', 'en'), 'Jul 18, 2001');
  assert.throws(() => formatDateOnly('2001-07-18T00:00:00Z', 'vi'), RangeError);
});

test('machine zone does not leak in (Tokyo too); without timeZone it does', () => {
  const run = (TZ: string) => execFileSync(process.execPath, ['--import', 'tsx', 'test/fixtures/print-dates.ts'], { env: { ...process.env, TZ } }).toString();
  assert.equal(run('Asia/Tokyo'), run('UTC'));
  assert.match(run('UTC'), /15:30 24\/10\/2026/);
  const naive = (TZ: string) => execFileSync(process.execPath, ['-p', `new Date('2026-10-24T08:30:00Z').toLocaleString('vi-VN')`], { env: { ...process.env, TZ } }).toString().trim();
  assert.equal(naive('UTC'), '08:30:00 24/10/2026');
  assert.equal(naive('Asia/Ho_Chi_Minh'), '15:30:00 24/10/2026');
});

test('Temporal is not available in Node 22 without a flag', () => {
  assert.equal(typeof (globalThis as { Temporal?: unknown }).Temporal, 'undefined');
});
