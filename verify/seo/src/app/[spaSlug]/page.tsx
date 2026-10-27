// src/app/[spaSlug]/page.tsx — a spa's public booking page, rendered on the server per request
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { JsonLd, spaJsonLd } from '@/lib/json-ld';
import type { Day } from '@/lib/public-spa';
import { findPublicSpa } from '@/lib/spa-repo';
import { pageMetadata } from '@/lib/seo';
import { BookingForm } from './booking-form';

type Props = { params: Promise<{ spaSlug: string }> };

// One lookup for metadata and page. Nothing streams before it (no loading.tsx or <Suspense> above),
// so 404 and 308 are real status codes.
const loadSpa = cache(async (slug: string) => {
  const found = await findPublicSpa(slug);
  if (found.kind === 'moved') permanentRedirect(`/${found.slug}`);   // 308
  if (found.kind === 'missing') notFound();                         // 404, also for drafts and deleted spas
  return found.spa;
});

export async function generateMetadata({ params }: Props) {
  const spa = await loadSpa((await params).spaSlug);
  return pageMetadata({
    path: `/${spa.slug}`,
    title: `${spa.name}: đặt lịch online`,
    description: `${spa.about} ${spa.address.street}, ${spa.address.district}.`,
    ownOgImage: true,
  });
}

const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
const dayVi: Record<Day, string> = { Monday: 'T2', Tuesday: 'T3', Wednesday: 'T4', Thursday: 'T5', Friday: 'T6', Saturday: 'T7', Sunday: 'CN' };

export default async function SpaPage({ params }: Props) {
  const spa = await loadSpa((await params).spaSlug);
  return (
    <main>
      <JsonLd data={spaJsonLd(spa)} />
      <h1>{spa.name}</h1>
      <p>{spa.about}</p>
      {/* JSON-LD may state only what the page shows */}
      <address>
        {spa.address.street}, {spa.address.district}, {spa.address.city} · <a href={`tel:+84${spa.phone.slice(1)}`}>{spa.phone}</a>
      </address>
      <ul>
        {spa.hours.map((h) => (
          <li key={h.days.join()}>{h.days.map((d) => dayVi[d]).join(', ')}: {h.opens}–{h.closes}</li>
        ))}
      </ul>
      <p>Giá: {spa.priceRange}</p>
      <ul>
        {spa.services.map((s) => (
          <li key={s.name}>{s.name}: {vnd.format(s.priceVnd)}</li>
        ))}
      </ul>
      <BookingForm spa={spa} />
    </main>
  );
}
