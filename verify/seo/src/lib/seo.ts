// src/lib/seo.ts — builds the metadata of every public page
import type { Metadata } from 'next';

const siteUrl = process.env.SITE_URL;               // the production origin, in every environment
if (!siteUrl && process.env.NODE_ENV === 'production') throw new Error('SITE_URL is required');
export const SITE_URL = siteUrl ?? 'http://localhost:3000';
export const SITE_NAME = 'Đặt Lịch Spa';
export const NOINDEX: Metadata['robots'] = { index: false, follow: false };

// Vietnamese has no prefix, English lives under /en
export function languagesOf(viPath: string) {
  return { vi: viPath, en: viPath === '/' ? '/en' : `/en${viPath}`, 'x-default': viPath };
}

interface PageSeo {
  path: string;                         // this page's own URL, e.g. '/pricing'
  title: string;
  description: string;
  locale?: 'vi_VN' | 'en_US';
  languages?: ReturnType<typeof languagesOf>;
  ownOgImage?: boolean;                 // this page's folder has an opengraph-image.tsx
}

export function pageMetadata({ path, title, description, locale = 'vi_VN', languages, ownOgImage }: PageSeo): Metadata {
  // A page's openGraph replaces the parent's, image included. A folder's own
  // opengraph-image.tsx is used only when `images` is absent.
  const images = ownOgImage ? {} : { images: '/opengraph-image' };
  return {
    title,
    description,
    alternates: { canonical: path, languages },
    openGraph: { type: 'website', siteName: SITE_NAME, url: path, title, description, locale, ...images },
    twitter: { card: 'summary_large_image', title, description, ...images },
  };
}
