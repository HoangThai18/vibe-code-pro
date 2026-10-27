import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  path: '/pricing',
  title: 'Bảng giá',
  description: 'Gói Cơ bản 299.000₫/tháng, gói Chuyên nghiệp 699.000₫/tháng. Dùng thử 14 ngày.',
});

export default function Pricing() {
  return (
    <main>
      <h1>Bảng giá</h1>
      <p>Gói Cơ bản 299.000₫/tháng</p>
    </main>
  );
}
