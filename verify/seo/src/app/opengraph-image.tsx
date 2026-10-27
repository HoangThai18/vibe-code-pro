// src/app/opengraph-image.tsx — default share image for the marketing pages
import { ogImage, ogSize } from '@/lib/og-image';
import { SITE_NAME } from '@/lib/seo';

export const size = ogSize;
export const contentType = 'image/png';
export const alt = SITE_NAME;

export default function Image() {
  return ogImage(SITE_NAME, 'Đặt lịch gội đầu dưỡng sinh, massage, chăm sóc da');
}
