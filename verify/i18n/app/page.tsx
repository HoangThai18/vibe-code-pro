import { getTranslations } from 'next-intl/server';
import { AppointmentTime } from './appointment-time';

export default async function Page() {
  const t = await getTranslations('customers');
  return (
    <main>
      <p id="count">{t('count', { count: 1250 })}</p>
      <AppointmentTime at="2026-10-24T08:30:00Z" />
    </main>
  );
}
