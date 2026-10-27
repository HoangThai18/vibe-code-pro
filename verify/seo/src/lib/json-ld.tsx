// src/lib/json-ld.tsx
import type { DaySpa, WithContext } from 'schema-dts';
import type { PublicSpa } from './public-spa';
import { SITE_URL } from './seo';

export function spaJsonLd(spa: PublicSpa): WithContext<DaySpa> {
  const url = `${SITE_URL}/${spa.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'DaySpa',
    '@id': url,
    name: spa.name,
    url,
    description: spa.about,
    telephone: `+84${spa.phone.slice(1)}`,      // stored as 0912345678
    priceRange: spa.priceRange,
    address: {
      '@type': 'PostalAddress',
      streetAddress: spa.address.street,
      addressLocality: spa.address.district,
      addressRegion: spa.address.city,
      addressCountry: 'VN',
    },
    openingHoursSpecification: spa.hours.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: h.days,
      opens: h.opens,
      closes: h.closes,
    })),
  };
}

// JSON.stringify leaves "<" as is: a spa name containing "</script>" would close the tag and run what follows
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
