import { languagesOf, pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  path: '/en',
  title: 'Booking software for spas',
  description: 'Online booking 24/7, Zalo/SMS reminders, staff and revenue management for spas in Vietnam.',
  locale: 'en_US',
  languages: languagesOf('/'),
});

export default function HomeEn() {
  return (
    <main lang="en">
      <h1>Spa management and online booking</h1>
      <p>Customers book online; the spa answers fewer calls.</p>
    </main>
  );
}
