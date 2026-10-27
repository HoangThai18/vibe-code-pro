// test/format.test.ts — exact strings, invisible characters included
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { formatDateOnly, formatDateTime, formatMoney, localDate, parseVndInput } from '../src/i18n/format';

const VN = { locale: 'vi', timeZone: 'Asia/Ho_Chi_Minh' } as const;

test('VND: dots for thousands, no decimals, U+00A0 before ₫', () => {
  assert.equal(formatMoney({ amount: 1_250_000, currency: 'VND' }, 'vi'), '1.250.000\u00a0₫');
  assert.notEqual(formatMoney({ amount: 1_250_000, currency: 'VND' }, 'vi'), '1.250.000 ₫'); // a typed space
  assert.equal(formatMoney({ amount: 1_250_000, currency: 'VND' }, 'en'), '₫1,250,000');
  assert.equal(formatMoney({ amount: 125_050, currency: 'USD' }, 'vi'), '1.250,50\u00a0US$');
  assert.throws(() => formatMoney({ amount: 999.5, currency: 'VND' }, 'vi'), RangeError);
});

test('typed amounts: separators dropped, shorthand refused', () => {
  for (const s of ['1.250.000', '1,250,000', '1 250 000', '1.250.000 ₫']) assert.equal(parseVndInput(s), 1_250_000, s);
  for (const s of ['1,25tr', '500k', '1,5', '12.50.000', '-50000']) assert.equal(parseVndInput(s), null, s);
});

test('instants in the tenant zone, same result whatever TZ the machine has', () => {
  const at = new Date('2026-10-24T08:30:00Z');
  assert.equal(formatDateTime(at, VN), '15:30 24/10/2026');
  assert.equal(formatDateTime(at, { locale: 'en', timeZone: VN.timeZone }), 'Oct 24, 2026, 3:30 PM');
  const run = (TZ: string) => execFileSync(process.execPath, ['--import', 'tsx', 'test/fixtures/print-dates.ts'], { env: { ...process.env, TZ } }).toString();
  assert.equal(run('America/New_York'), run('UTC'));
});

test('day boundary: 17:00 UTC is midnight in Vietnam; date-only values keep their day', () => {
  assert.equal(localDate(new Date('2026-10-24T16:59:59Z'), VN.timeZone), '2026-10-24');
  assert.equal(localDate(new Date('2026-10-24T17:00:00Z'), VN.timeZone), '2026-10-25');
  assert.equal(formatDateOnly('2001-07-18', 'vi'), '18/07/2001');
});
