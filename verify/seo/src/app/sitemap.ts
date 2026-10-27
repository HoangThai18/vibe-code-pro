// src/app/sitemap.ts — /sitemap.xml: the marketing pages
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

const CONTENT_UPDATED = new Date('2026-10-01T00:00:00Z');   // when the copy last changed, not the build time

export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/en', '/pricing'].map((path) => ({ url: `${SITE_URL}${path}`, lastModified: CONTENT_UPDATED }));
}
