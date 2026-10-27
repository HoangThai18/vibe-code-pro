// src/app/page.tsx — static: the HTML is built once, content is in it without JavaScript
import { languagesOf, pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  path: '/',
  title: 'Phần mềm đặt lịch cho spa',
  description: 'Khách tự đặt lịch online 24/7, nhắc lịch qua Zalo/SMS, quản lý nhân viên và doanh thu.',
  languages: languagesOf('/'),
  ownOgImage: true,                    // src/app/opengraph-image.tsx sits in this folder
});

export default function Home() {
  return (
    <main>
      <h1>Phần mềm quản lý và đặt lịch cho spa</h1>
      <p>Khách tự đặt lịch online, spa bớt nghe điện thoại.</p>
      <a href="/pricing">Bảng giá</a>
    </main>
  );
}
