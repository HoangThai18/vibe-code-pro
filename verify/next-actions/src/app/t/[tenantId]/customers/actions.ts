// src/app/t/[tenantId]/customers/actions.ts
'use server';
import { updateTag } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db/tenant';
import { checkAccess, type Denied } from '@/lib/access';
import { pool } from '@/lib/db';
import { customersTag } from './data';

const RenameCustomer = z.strictObject({ customerId: z.uuid(), fullName: z.string().trim().min(1).max(200) });

// A Server Action is a public POST endpoint: anyone can call it with any arguments, the bound tenantId included
export async function renameCustomer(tenantId: string, input: unknown): Promise<{ ok: true } | Denied | { ok: false; code: 'invalid_input' }> {
  const access = await checkAccess(tenantId, 'customer.write');   // session, membership, permission: on every call
  if (!access.ok) return access;
  const parsed = RenameCustomer.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  const { rowCount } = await withTenant(pool, tenantId, (db) =>
    db.query('UPDATE customers SET full_name = $2 WHERE id = $1', [parsed.data.customerId, parsed.data.fullName]));
  if (rowCount === 0) return { ok: false, code: 'not_found' };   // another tenant's customer: RLS hides it
  updateTag(customersTag(tenantId));   // this tenant's entries only; the response already shows the new name
  return { ok: true };
}
