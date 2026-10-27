// src/lib/spa-repo.ts — fake repository for the test app. A real one reads the database
// (only the public columns, only published spas); the function signatures stay the same.
import type { Day, PublicSpa, SpaLookup } from './public-spa';

interface SpaRow extends PublicSpa {
  tenantId: string;
  status: 'published' | 'draft' | 'deleted';
  oldSlugs: string[];
  ownerPhone: string;                  // private: must never reach a public page
  customerCount: number;               // private
}

const week: Day[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const rows: SpaRow[] = [
  {
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status: 'published', slug: 'spa-hoa-mai', oldSlugs: ['hoa-mai-spa'],
    name: 'Spa Hoa Mai', about: 'Gội đầu dưỡng sinh, massage body và chăm sóc da mặt tại Quận 3.',
    phone: '0912345678', ownerPhone: '0987654321', customerCount: 1834,
    address: { street: '12 Lê Văn Sỹ', district: 'Quận 3', city: 'TP. Hồ Chí Minh' },
    hours: [{ days: week, opens: '09:00', closes: '21:00' }, { days: ['Saturday', 'Sunday'], opens: '08:00', closes: '22:00' }],
    priceRange: '150.000₫ - 1.200.000₫',
    services: [{ name: 'Gội đầu dưỡng sinh', priceVnd: 150_000 }, { name: 'Massage body 90 phút', priceVnd: 450_000 }],
    updatedAt: new Date('2026-10-20T03:00:00Z'),
  },
  {
    tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', status: 'published', slug: 'sen-vang', oldSlugs: [],
    name: 'Sen Vàng </script><script>alert(1)</script>', about: 'Tên do chủ spa tự nhập: phải được escape.',
    phone: '0901234567', ownerPhone: '0977000111', customerCount: 12,
    address: { street: '5 Hàng Bông', district: 'Hoàn Kiếm', city: 'Hà Nội' },
    hours: [{ days: week, opens: '10:00', closes: '20:00' }],
    priceRange: '200.000₫ - 800.000₫', services: [{ name: 'Chăm sóc da mặt', priceVnd: 300_000 }],
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  },
  {
    tenantId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', status: 'draft', slug: 'spa-nhap', oldSlugs: [],
    name: 'Spa chưa công khai', about: '', phone: '0900000001', ownerPhone: '0900000002', customerCount: 0,
    address: { street: '', district: '', city: '' }, hours: [], priceRange: '', services: [], updatedAt: new Date(),
  },
  {
    tenantId: 'dddddddd-dddd-dddd-dddd-dddddddddddd', status: 'deleted', slug: 'spa-da-dong', oldSlugs: [],
    name: 'Spa đã đóng', about: '', phone: '0900000003', ownerPhone: '0900000004', customerCount: 0,
    address: { street: '', district: '', city: '' }, hours: [], priceRange: '', services: [], updatedAt: new Date(),
  },
];

// 50,000 more published spas so the sitemap has to split (test data only)
const SYNTHETIC = 50_000;
const synthetic = (i: number) => ({ slug: `spa-mau-${String(i).padStart(5, '0')}`, updatedAt: new Date('2026-01-01T00:00:00Z') });

// Map the row field by field: spreading `row` would leak ownerPhone, customerCount, tenantId into metadata and JSON-LD
function toPublic(row: SpaRow): PublicSpa {
  const { slug, name, about, phone, address, hours, priceRange, services, updatedAt } = row;
  return { slug, name, about, phone, address, hours, priceRange, services, updatedAt };
}

// Simulated query latency (FAKE_DB_DELAY_MS), to see how a slow lookup affects streaming
const delay = () => new Promise((r) => setTimeout(r, Number(process.env.FAKE_DB_DELAY_MS ?? 0)));

export async function findPublicSpa(requested: string): Promise<SpaLookup> {
  await delay();
  const slug = requested.toLowerCase();
  const row = rows.find((r) => r.slug === slug || r.oldSlugs.includes(slug));
  if (!row || row.status !== 'published') return { kind: 'missing' };
  if (row.slug !== requested) return { kind: 'moved', slug: row.slug };
  return { kind: 'found', spa: toPublic(row) };
}

export async function countPublishedSpas(): Promise<number> {
  return rows.filter((r) => r.status === 'published').length + SYNTHETIC;
}

// Stable order (by slug) so pages of the sitemap do not overlap
export async function listPublishedSpas(offset: number, limit: number): Promise<{ slug: string; updatedAt: Date }[]> {
  const real = rows.filter((r) => r.status === 'published').map((r) => ({ slug: r.slug, updatedAt: r.updatedAt }));
  const all = [...real, ...Array.from({ length: SYNTHETIC }, (_, i) => synthetic(i))];
  return all.sort((a, b) => a.slug.localeCompare(b.slug)).slice(offset, offset + limit);
}
