// src/app/robots.ts — /robots.txt
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';
import { generateSitemaps } from './spas/sitemap';

export const revalidate = 3600;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const spaSitemaps = (await generateSitemaps()).map(({ id }) => `${SITE_URL}/spas/sitemap/${id}.xml`);
  return {
    // No Disallow for /login or /t/: a crawler that may not fetch a page never sees its noindex
    rules: { userAgent: '*', allow: '/' },
    sitemap: [`${SITE_URL}/sitemap.xml`, ...spaSitemaps],       // generateSitemaps writes no index file
  };
}
