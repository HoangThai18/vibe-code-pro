// src/app/t/[tenantId]/layout.tsx — the logged-in app: every page below inherits noindex
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NOINDEX } from '@/lib/seo';

export const metadata: Metadata = { robots: NOINDEX };

export default function AppLayout({ children }: { children: ReactNode }) {
  return <div className="app-shell">{children}</div>;
}
