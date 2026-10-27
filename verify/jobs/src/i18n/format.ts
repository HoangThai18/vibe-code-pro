// src/i18n/format.ts — the ONLY place that formats money and dates (web, API, SMS, email, PDF)
export const LOCALES = ['vi', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
// Always passed in, from user/customer + tenant settings; never read from the machine
export interface I18nContext { locale: Locale; timeZone: string } // IANA zone, e.g. 'Asia/Ho_Chi_Minh'

// ISO 4217 minor units; the currency comes with the price, never from the locale
const MINOR_UNITS = { VND: 0, USD: 2 } as const;
export type Currency = keyof typeof MINOR_UNITS;
export interface Money { amount: number; currency: Currency } // integer, smallest unit (đồng, cent)

// Node 22: new Intl.DateTimeFormat ≈ 70 µs, reusing one ≈ 2 µs
const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, make: () => T): T {
  let f = cache.get(key);
  if (!f) cache.set(key, (f = make()));
  return f as T;
}

export function formatMoney(m: Money, locale: Locale): string {
  // Intl prints 999.5 as "1.000 ₫" silently: a fraction is a bug upstream
  if (!Number.isSafeInteger(m.amount)) throw new RangeError(`Money.amount must be an integer: ${m.amount}`);
  const d = MINOR_UNITS[m.currency];
  return cached(`money|${locale}|${m.currency}`, () => new Intl.NumberFormat(locale,
    { style: 'currency', currency: m.currency, minimumFractionDigits: d, maximumFractionDigits: d })).format(m.amount / 10 ** d);
}

// "1.250.000", "1,250,000", "1 250 000", "1250000đ" → 1250000; "1,25tr", "500k", "1,5" → null (ask again, never guess)
export function parseVndInput(input: string): number | null {
  const s = input.normalize('NFC').trim().replace(/\s*(₫|đ|vnđ|vnd)$/iu, '');
  if (!/^(?:\d+|\d{1,3}([., ])\d{3}(?:\1\d{3})*)$/u.test(s)) return null;
  const n = Number(s.replace(/\D/g, ''));
  return Number.isSafeInteger(n) ? n : null;
}

// vi "15:30 24/10/2026" (dateStyle 'short' gives a 2-digit year); en "Oct 24, 2026, 3:30 PM" (no 10/24 vs 24/10 doubt)
const DATE_TIME: Record<Locale, Intl.DateTimeFormatOptions> = {
  vi: { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' },
  en: { dateStyle: 'medium', timeStyle: 'short' },
};

// An instant (timestamptz). Without timeZone, Intl uses the machine's zone (server: UTC, browser: anything)
export function formatDateTime(at: Date, ctx: I18nContext): string {
  return cached(`dt|${ctx.locale}|${ctx.timeZone}`, () =>
    new Intl.DateTimeFormat(ctx.locale, { ...DATE_TIME[ctx.locale], timeZone: ctx.timeZone })).format(at);
}

// A calendar date (SQL `date`, 'YYYY-MM-DD' in the API: birthdays) has no zone, so format it in UTC
export function formatDateOnly(isoDate: string, locale: Locale): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new RangeError(`Expected YYYY-MM-DD: ${isoDate}`);
  const { hour, minute, timeStyle, ...dateOnly } = DATE_TIME[locale];
  return cached(`d|${locale}`, () => new Intl.DateTimeFormat(locale, { ...dateOnly, timeZone: 'UTC' }))
    .format(new Date(`${isoDate}T00:00:00Z`));
}

// 'YYYY-MM-DD' of an instant in a zone (en-CA formats ISO-style), e.g. "today" for the tenant
export const localDate = (at: Date, timeZone: string): string =>
  cached(`iso|${timeZone}`, () => new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' })).format(at);
