'use client';
// Props of a client component are serialized into the page HTML: pass PublicSpa, never a DB row
import { useState } from 'react';
import type { PublicSpa } from '@/lib/public-spa';

export function BookingForm({ spa }: { spa: PublicSpa }) {
  const [service, setService] = useState(spa.services[0]?.name ?? '');
  return (
    <form action={`/${spa.slug}/dat-lich`}>
      <select name="service" value={service} onChange={(e) => setService(e.target.value)}>
        {spa.services.map((s) => (
          <option key={s.name}>{s.name}</option>
        ))}
      </select>
      <button>Đặt lịch</button>
    </form>
  );
}
