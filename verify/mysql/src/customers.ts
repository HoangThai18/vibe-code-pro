// src/customers.ts — every statement filters tenant_id = db.tenantId: nothing in the database does it for you
import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { errno, type TenantDb } from './db/tenant';
import { authorize, type Actor } from './shared/authz';
import { HttpError, NotFoundError } from './shared/errors';

export interface Customer { id: string; fullName: string; phone: string; email: string | null; createdAt: Date }
const COLUMNS = 'id, full_name AS fullName, phone, email, created_at AS createdAt';

export function normalizePhone(input: string): string {
  let d = input.replace(/[\s.\-()]/g, '');
  if (d.startsWith('+84')) d = `0${d.slice(3)}`;
  else if (/^84\d{9,10}$/.test(d)) d = `0${d.slice(2)}`;
  if (!/^0\d{9,10}$/.test(d)) throw new HttpError(400, 'validation_failed', 'SĐT không hợp lệ (ví dụ 0912345678).');
  return d;
}
// MySQL has no "IS NFC NORMALIZED": a decomposed name (macOS, iOS) never matches LIKE '%phuong%'
export const cleanName = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

export async function getCustomer(db: TenantDb, actor: Actor, id: string): Promise<Customer> {
  authorize(actor, 'customer.read');
  const [rows] = await db.conn.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM customers WHERE tenant_id = ? AND id = ?`, [db.tenantId, id]);
  if (!rows[0]) throw new NotFoundError();   // another tenant's id looks exactly like a missing one
  return rows[0] as Customer;
}

export async function createCustomer(db: TenantDb, actor: Actor,
  input: { fullName: string; phone: string; email?: string | null }): Promise<Customer> {
  authorize(actor, 'customer.write');
  const id = randomUUID();
  try {
    await db.conn.query('INSERT INTO customers (tenant_id, id, full_name, phone, email) VALUES (?, ?, ?, ?, ?)',
      [db.tenantId, id, cleanName(input.fullName), normalizePhone(input.phone), input.email ?? null]);
  } catch (err) {
    // 1062 ER_DUP_ENTRY names the key: "... for key 'customers.customers_phone'"
    if (errno(err) === 1062 && String((err as Error).message).includes('customers_phone')) {
      throw new HttpError(409, 'customer_phone_taken', 'Số điện thoại này đã có trong workspace.');
    }
    throw err;
  }
  return getCustomer(db, actor, id);
}

export async function updateCustomer(db: TenantDb, actor: Actor, id: string,
  patch: { fullName?: string; email?: string | null }): Promise<Customer> {
  authorize(actor, 'customer.write');
  const [res] = await db.conn.query<ResultSetHeader>(
    `UPDATE customers SET full_name = COALESCE(?, full_name), email = IF(?, ?, email)
      WHERE tenant_id = ? AND id = ?`,
    [patch.fullName === undefined ? null : cleanName(patch.fullName), 'email' in patch, patch.email ?? null, db.tenantId, id]);
  // mysql2 sets CLIENT_FOUND_ROWS: affectedRows counts matched rows, so an unchanged row is not a 404
  if (res.affectedRows === 0) throw new NotFoundError();
  return getCustomer(db, actor, id);
}

// Keyset pagination, newest first. Spelled out with OR: MySQL 8.4 does not turn the row comparison
// (created_at, id) < (?, ?) into an index range. DATETIME(3) round-trips exactly through a JS Date.
export async function listCustomers(db: TenantDb, actor: Actor, opts: { limit?: number; cursor?: string | null } = {}) {
  authorize(actor, 'customer.read');
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const after = opts.cursor ? (JSON.parse(Buffer.from(opts.cursor, 'base64url').toString()) as [string, string]) : null;
  const [rows] = await db.conn.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM customers
      WHERE tenant_id = ? ${after ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''}
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    after ? [db.tenantId, new Date(after[0]), new Date(after[0]), after[1], limit + 1] : [db.tenantId, limit + 1]);
  const page = rows.slice(0, limit) as Customer[];
  const last = page.at(-1);
  const nextCursor = rows.length > limit && last
    ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id])).toString('base64url') : null;
  return { data: page, nextCursor };
}
