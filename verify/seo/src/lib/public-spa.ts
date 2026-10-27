// src/lib/public-spa.ts — what a spa's public page may show
export type Day = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

// Only what the spa chose to publish. Nothing from customers, staff, billing or the owner's account.
export interface PublicSpa {
  slug: string;
  name: string;
  about: string;
  phone: string;                       // the spa's public business number, '0912345678'
  address: { street: string; district: string; city: string };
  hours: { days: Day[]; opens: string; closes: string }[];
  priceRange: string;
  services: { name: string; priceVnd: number }[];
  updatedAt: Date;
}

export type SpaLookup =
  | { kind: 'found'; spa: PublicSpa }
  | { kind: 'moved'; slug: string }     // old slug or different case: redirect
  | { kind: 'missing' };                // unknown, not published, deleted: 404
