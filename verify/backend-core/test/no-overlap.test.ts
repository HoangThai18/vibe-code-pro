// data-layer.md section 6: the exclusion constraint blocks double booking, even for concurrent requests
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { bookAppointment, type NewAppointment } from '../src/appointments/book';
import { createTenant, withMember, withTenant } from '../src/db/tenant';
import { HttpError } from '../src/shared/errors';
import { newAdminPool, newAppPool, reset } from './support/db';

const admin = newAdminPool();
const app = newAppPool();
afterAll(async () => { await Promise.all([admin.end(), app.end()]); });

let A = '', owner = '', staff = '', other = '', customer = '';
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 2, h, m));
const slot = (staffUserId: string, from: number, to: number): NewAppointment => ({ customerId: customer, staffUserId, startsAt: at(from), endsAt: at(to) });
const book = (userId: string, a: NewAppointment) => withMember(app, A, userId, (db, actor) => bookAppointment(db, actor, a));
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof HttpError ? e.code : String(e)));

beforeEach(async () => {
  await reset(admin);
  const ids = await admin.query<{ id: string }>("INSERT INTO users (email) VALUES ('o@x.vn'), ('s@x.vn'), ('t@x.vn') RETURNING id");
  [owner, staff, other] = ids.rows.map((r) => r.id) as [string, string, string];
  A = await createTenant(app, owner, 'Spa A');
  await withTenant(app, A, async (db) => {
    await db.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'staff'), ($1, $3, 'staff')", [A, staff, other]);
    customer = (await db.query<{ id: string }>("INSERT INTO customers (full_name, phone) VALUES ('Lan', '0912345678') RETURNING id")).rows[0]!.id;
  });
});

describe('no double booking', () => {
  it('overlap → 409 appointment_slot_taken; back-to-back, another staff member, or a cancelled slot are fine', async () => {
    await book(owner, slot(staff, 3, 4));
    expect(await code(book(owner, slot(staff, 3, 4)))).toBe('appointment_slot_taken');
    expect(await code(book(owner, { ...slot(staff, 3, 4), startsAt: at(3, 30), endsAt: at(4, 30) }))).toBe('appointment_slot_taken');
    expect(await code(book(owner, slot(staff, 4, 5)))).toBe('ok');     // [3,4) and [4,5) don't overlap
    expect(await code(book(owner, slot(other, 3, 4)))).toBe('ok');
    await withTenant(app, A, (db) => db.query("UPDATE appointments SET status = 'cancelled' WHERE starts_at = $1 AND staff_user_id = $2", [at(3), staff]));
    expect(await code(book(owner, slot(staff, 3, 4)))).toBe('ok');
  });

  it('ten concurrent bookings of one slot: exactly one wins', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => code(book(owner, slot(staff, 9, 10)))));
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'appointment_slot_taken')).toHaveLength(9);
  });

  it('staff book only for themselves; another tenant\'s customer is 422', async () => {
    expect(await code(book(staff, slot(other, 3, 4)))).toBe('forbidden');
    expect(await code(book(staff, slot(staff, 3, 4)))).toBe('ok');
    expect(await code(book(owner, { ...slot(other, 5, 6), customerId: '00000000-0000-4000-8000-000000000000' }))).toBe('invalid_reference');
  });
});
