import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkMessages } from '../src/i18n/check-messages';
import { resolveLocale } from '../src/i18n/locale';
import { getTranslator, withFallback } from '../src/i18n/messages';
import { reminderText } from '../src/notify/reminder-text';

test('plural categories: vi has only other, en has one/other', () => {
  assert.deepEqual(new Intl.PluralRules('vi').resolvedOptions().pluralCategories, ['other']);
  assert.deepEqual(new Intl.PluralRules('en').resolvedOptions().pluralCategories, ['one', 'other']);
  assert.equal(new Intl.PluralRules('vi').select(1), 'other');
  assert.equal(new Intl.PluralRules('en').select(1), 'one');
  assert.equal(new Intl.PluralRules('en').select(0), 'other');
});

test('ICU plurals per locale, # uses the locale number format', () => {
  const vi = getTranslator('vi');
  const en = getTranslator('en');
  assert.equal(vi('customers.count', { count: 1 }), '1 khách');
  assert.equal(vi('customers.count', { count: 1250 }), '1.250 khách');
  assert.equal(en('customers.count', { count: 1 }), '1 customer');
  assert.equal(en('customers.count', { count: 1250 }), '1,250 customers');
  assert.equal(vi('appointments.todayCount', { count: 0 }), 'Hôm nay chưa có lịch hẹn');
  assert.equal(en('appointments.todayCount', { count: 0 }), 'No appointments today');
  assert.equal(en('appointments.todayCount', { count: 1 }), '1 appointment today');
});

test('a key missing in en falls back to vi; an unknown key throws', () => {
  const merged = withFallback({ a: { hi: 'Xin chào {name}', bye: 'Tạm biệt' } }, { a: { hi: 'Hello {name}' } });
  assert.deepEqual(merged, { a: { hi: 'Hello {name}', bye: 'Tạm biệt' } });
  assert.equal(getTranslator('en')('customers.count', { count: 2 }), '2 customers');
  assert.throws(() => getTranslator('en')('nope.key'), /Unknown message key/);
});

test('reminder SMS: customer language, tenant zone, optional ASCII', () => {
  const a = { customerName: 'Đặng Thị Ánh', spaName: 'Spa Hoa Mai', startsAt: new Date('2026-10-24T08:30:00Z') };
  const tz = 'Asia/Ho_Chi_Minh';
  assert.equal(reminderText(a, { locale: 'vi', timeZone: tz }, { ascii: false }),
    'Chào Đặng Thị Ánh, nhắc lịch hẹn của bạn lúc 15:30 24/10/2026 tại Spa Hoa Mai.');
  assert.equal(reminderText(a, { locale: 'vi', timeZone: tz }, { ascii: true }),
    'Chao Dang Thi Anh, nhac lich hen cua ban luc 15:30 24/10/2026 tai Spa Hoa Mai.');
  assert.equal(reminderText(a, { locale: 'en', timeZone: tz }, { ascii: false }),
    'Hi Đặng Thị Ánh, reminder: your appointment at Spa Hoa Mai is on Oct 24, 2026, 3:30 PM.');
});

test('locale: user > tenant > Accept-Language > vi', () => {
  assert.equal(resolveLocale({ user: 'en', tenant: 'vi', acceptLanguage: 'vi' }), 'en');
  assert.equal(resolveLocale({ user: null, tenant: 'vi', acceptLanguage: 'en-US,en;q=0.9' }), 'vi');
  assert.equal(resolveLocale({ acceptLanguage: 'fr-FR,fr;q=0.9,en-GB;q=0.8,vi;q=0.7' }), 'en');
  assert.equal(resolveLocale({ acceptLanguage: 'vi;q=0.5,en;q=0.9' }), 'en');
  assert.equal(resolveLocale({ acceptLanguage: 'en;q=0,fr' }), 'vi');
  assert.equal(resolveLocale({ user: 'de', acceptLanguage: '*' }), 'vi');
});

function catalogDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'msgs-'));
  for (const [locale, body] of Object.entries(files)) writeFileSync(join(dir, `${locale}.json`), JSON.stringify(body));
  return dir;
}
const vi = { a: { hi: 'Chào {name}', n: '{count, plural, other {# khách}}' } };

test('catalog check: the real catalogs pass', () => {
  assert.deepEqual(checkMessages('messages'), []);
});

test('catalog check: missing, extra, renamed argument, wrong plural branches, broken ICU', () => {
  const cases: [unknown, RegExp][] = [
    [{ a: { hi: 'Hi {name}' } }, /en: missing a\.n/],
    [{ a: { hi: 'Hi {name}', n: '{count, plural, one {#} other {#}}', x: 'X' } }, /en: a\.x is not in vi\.json/],
    [{ a: { hi: 'Hi {nmae}', n: '{count, plural, one {#} other {#}}' } }, /en: a\.hi: Missing variable name/],
    [{ a: { hi: 'Hi {name}', n: '{count, plural, other {# customers}}' } }, /en: a\.n: \{count\} lacks 'one'/],
    [{ a: { hi: 'Hi {name', n: '{count, plural, one {#} other {#}}' } }, /en: a\.hi: invalid ICU message/],
  ];
  for (const [en, expected] of cases) assert.match(checkMessages(catalogDir({ vi, en })).join('\n'), expected);
  const viWithOne = { a: { hi: 'Chào {name}', n: '{count, plural, one {# khách} other {# khách}}' } };
  assert.match(checkMessages(catalogDir({ vi: viWithOne, en: viWithOne })).join('\n'), /vi: a\.n: \{count\} has 'one', not a vi category/);
});

test('catalog check CLI: exit code fails the CI job', () => {
  const cli = (dir: string) => execFileSync(process.execPath, ['--import', 'tsx', 'src/i18n/check-messages.ts', dir], { stdio: 'pipe' });
  assert.doesNotThrow(() => cli('messages'));
  assert.throws(() => cli(catalogDir({ vi, en: { a: { hi: 'Hi {name}' } } })), (err: { status: number; stderr: Buffer }) =>
    err.status === 1 && err.stderr.toString().includes('en: missing a.n'));
});
