import type { Metadata } from 'next';
import { NOINDEX } from '@/lib/seo';

export const metadata: Metadata = { title: 'Đăng nhập', robots: NOINDEX };

export default function Login() {
  return (
    <main>
      <h1>Đăng nhập</h1>
    </main>
  );
}
