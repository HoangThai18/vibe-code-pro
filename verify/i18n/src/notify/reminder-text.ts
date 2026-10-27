// src/notify/reminder-text.ts
import { formatDateTime, type I18nContext } from '../i18n/format';
import { getTranslator } from '../i18n/messages';
import { removeDiacritics } from '../i18n/text';

// ctx = the CUSTOMER's language (customers.locale ?? tenants.default_locale) + the tenant's zone
export function reminderText(a: { customerName: string; spaName: string; startsAt: Date }, ctx: I18nContext, opts: { ascii: boolean }) {
  const text = getTranslator(ctx.locale)('appointments.reminderSms',
    { name: a.customerName, spa: a.spaName, when: formatDateTime(a.startsAt, ctx) });
  return opts.ascii ? removeDiacritics(text) : text;
}
