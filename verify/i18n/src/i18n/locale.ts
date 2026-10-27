// src/i18n/locale.ts — which language the staff UI uses
import { LOCALES, type Locale } from './format';

export const DEFAULT_LOCALE: Locale = 'vi';
export const isLocale = (v: unknown): v is Locale => (LOCALES as readonly unknown[]).includes(v);

// The user's saved choice > the tenant's default > the browser's Accept-Language > vi
export function resolveLocale(o: { user?: string | null; tenant?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(o.user)) return o.user;
  if (isLocale(o.tenant)) return o.tenant;
  const ranked = (o.acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', q = 'q=1'] = part.trim().split(';');
      return { base: tag.split('-')[0]?.trim().toLowerCase(), q: Number(q.trim().slice(2)) };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q);
  return ranked.map((x) => x.base).find(isLocale) ?? DEFAULT_LOCALE;
}
