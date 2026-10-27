// src/i18n/request.ts — next-intl 4, Next.js App Router staff app (no locale in the URL)
import { getRequestConfig } from 'next-intl/server';
import { headers } from 'next/headers';
import { getViewer } from '../server/viewer'; // yours: session user + settings of the tenant in the URL
import { resolveLocale } from './locale';
import { messagesFor } from './messages';

export default getRequestConfig(async () => {
  const viewer = await getViewer();
  const acceptLanguage = (await headers()).get('accept-language');
  const locale = resolveLocale({ user: viewer.userLocale, tenant: viewer.tenantLocale, acceptLanguage });
  // Server and browser render with this zone and clock
  return { locale, timeZone: viewer.timeZone, now: new Date(), messages: messagesFor(locale) };
});
