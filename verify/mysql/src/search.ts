// src/search.ts — customers by name or phone, accent-insensitive through the column collation
import type { RowDataPacket } from 'mysql2/promise';
import { cleanName } from './customers';
import type { TenantDb } from './db/tenant';
import { authorize, type Actor } from './shared/authz';

// utf8mb4_0900_ai_ci: 'nguyen' matches 'Nguyễn' and 'dang' matches 'Đặng'; each word is matched separately.
// ORDER BY full_name follows the (tenant_id, full_name) index, so the scan stops after `limit` matches;
// the page is then put in Vietnamese order in the app (an ORDER BY with the vi collation sorts every match).
const vi = new Intl.Collator('vi');
export async function searchCustomers(db: TenantDb, actor: Actor, q: string, limit = 20) {
  authorize(actor, 'customer.read');
  const text = cleanName(q);
  if (text.length < 2) return [];
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);   // % and _ typed by the user are text
  const digits = text.replace(/\D/g, '');
  const isPhone = /^[\d\s.+()-]+$/.test(text) && digits.length >= 3;
  const phone = digits.startsWith('84') && digits.length >= 11 ? `0${digits.slice(2)}` : digits;
  const words = text.split(' ').slice(0, 5);
  const [rows] = await db.conn.query<RowDataPacket[]>(
    `SELECT id, full_name AS fullName, phone FROM customers
      WHERE tenant_id = ? AND ${isPhone ? 'phone LIKE ?' : words.map(() => 'full_name LIKE ?').join(' AND ')}
      ORDER BY ${isPhone ? 'phone' : 'full_name'} LIMIT ?`,
    [db.tenantId, ...(isPhone ? [`%${esc(phone)}%`] : words.map((w) => `%${esc(w)}%`)), limit]);
  // Typed with accents: names containing exactly what was typed come first
  const typed = text.toLocaleLowerCase('vi');
  const exact = (name: string) => (typed !== typed.normalize('NFD').replace(/\p{M}/gu, '') && name.toLocaleLowerCase('vi').includes(typed) ? 0 : 1);
  return (rows as { id: string; fullName: string; phone: string }[])
    .sort((x, y) => exact(x.fullName) - exact(y.fullName) || vi.compare(x.fullName, y.fullName));
}
