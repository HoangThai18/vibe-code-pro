// src/app/layout.tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SITE_NAME, SITE_URL } from '@/lib/seo';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),      // relative canonical/OG URLs become absolute
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
