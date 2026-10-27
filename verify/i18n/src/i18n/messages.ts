// src/i18n/messages.ts — catalogs with vi fallback; t() for SMS, email, PDF
import { IntlMessageFormat } from 'intl-messageformat';
import en from '../../messages/en.json' with { type: 'json' };
import vi from '../../messages/vi.json' with { type: 'json' };
import type { Locale } from './format';

export type Catalog = { [key: string]: string | Catalog };
export type Messages = typeof vi;

// A key missing in en shows the vi text (CI should catch it first)
export function withFallback(base: Catalog, over: Catalog): Catalog {
  const out: Catalog = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = typeof v === 'object' && typeof b === 'object' ? withFallback(b, v) : v;
  }
  return out;
}
const CATALOGS: Record<Locale, Messages> = { vi, en: withFallback(vi, en) as Messages };
export const messagesFor = (locale: Locale): Messages => CATALOGS[locale];

// Money and dates arrive formatted by format.ts: {at, date} in a message uses the machine's zone
export function getTranslator(locale: Locale) {
  return (key: string, values?: Record<string, string | number>): string => {
    let node: string | Catalog | undefined = CATALOGS[locale];
    for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
    if (typeof node !== 'string') throw new Error(`Unknown message key: ${key}`);
    return String(new IntlMessageFormat(node, locale).format(values));
  };
}
