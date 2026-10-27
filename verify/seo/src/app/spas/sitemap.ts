// src/app/spas/sitemap.ts — /spas/sitemap/0.xml, /spas/sitemap/1.xml...: published spa pages
import type { MetadataRoute } from 'next';
import { countPublishedSpas, listPublishedSpas } from '@/lib/spa-repo';
import { SITE_URL } from '@/lib/seo';

const PER_FILE = 50_000;                            // per-file limit (also 50 MB uncompressed)
export const revalidate = 3600;                     // regenerate at most hourly

export async function generateSitemaps() {
  const files = Math.max(1, Math.ceil((await countPublishedSpas()) / PER_FILE));
  return Array.from({ length: files }, (_, id) => ({ id }));
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const id = Number(await props.id);               // Next 16: a promise of a string
  const spas = await listPublishedSpas(id * PER_FILE, PER_FILE);   // ordered by slug
  return spas.map((s) => ({ url: `${SITE_URL}/${s.slug}`, lastModified: s.updatedAt }));
}
