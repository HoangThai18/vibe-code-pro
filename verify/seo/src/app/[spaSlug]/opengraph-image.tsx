// src/app/[spaSlug]/opengraph-image.tsx — becomes og:image and twitter:image of the spa page
import { notFound } from 'next/navigation';
import { ogImage, ogSize } from '@/lib/og-image';
import { findPublicSpa } from '@/lib/spa-repo';

export const size = ogSize;
export const contentType = 'image/png';
export const alt = 'Trang đặt lịch của spa';

export default async function Image({ params }: { params: Promise<{ spaSlug: string }> }) {
  const found = await findPublicSpa((await params).spaSlug);
  if (found.kind !== 'found') notFound();          // no image for drafts or deleted spas either
  return ogImage(found.spa.name, `${found.spa.address.district}, ${found.spa.address.city}`);
}
