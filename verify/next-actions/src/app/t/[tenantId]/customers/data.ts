// src/app/t/[tenantId]/customers/data.ts
import { cacheLife, cacheTag } from 'next/cache';
import { withTenant } from '@/db/tenant';
import { pool } from '@/lib/db';

export const customersTag = (tenantId: string) => `tenant:${tenantId}:customers`;

// Shared by every user of the tenant, across requests. The tenant is an argument, so it is part of the cache key;
// the function reads no cookies or headers (Next.js refuses) and checks no access: call it after checkAccess
export async function listCustomers(tenantId: string) {
  'use cache';
  cacheLife('hours');
  cacheTag(customersTag(tenantId));
  const { rows } = await withTenant(pool, tenantId, (db) =>
    db.query<{ id: string; full_name: string }>('SELECT id, full_name FROM customers ORDER BY full_name'));
  return { customers: rows, loadedAt: new Date().toISOString() };
}
