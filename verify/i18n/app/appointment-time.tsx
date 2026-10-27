'use client';
// Client component: same format module; locale and zone come from the provider (request.ts), not the browser
import { useLocale, useTimeZone } from 'next-intl';
import { formatDateTime } from '../src/i18n/format';

export function AppointmentTime({ at }: { at: string }) {
  const ctx = { locale: useLocale(), timeZone: useTimeZone() ?? 'Asia/Ho_Chi_Minh' };
  return <time id="at" dateTime={at}>{formatDateTime(new Date(at), ctx)}</time>;
}
