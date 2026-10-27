// src/appointments/book.ts — inside withMember
import pg from 'pg';
import type { PoolClient } from 'pg';
import { authorize, ForbiddenError, type Actor } from '../shared/authz';
import { HttpError } from '../shared/errors';

export interface NewAppointment { customerId: string; staffUserId: string; startsAt: Date; endsAt: Date }

export async function bookAppointment(db: PoolClient, actor: Actor, a: NewAppointment): Promise<string> {
  authorize(actor, 'appointment.write');
  // Per-record rule (auth.md section 5): staff book only for themselves
  if (actor.type === 'user' && actor.role === 'staff' && a.staffUserId !== actor.id) throw new ForbiddenError('appointment.write');
  // One booking at a time per staff member: concurrent inserts checking the same exclusion constraint can
  // deadlock (40P01) instead of failing with 23P01. Rescheduling takes the same lock.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('booking:' || app_current_tenant() || ':' || $1, 0))", [a.staffUserId]);
  try {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO appointments (customer_id, staff_user_id, starts_at, ends_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [a.customerId, a.staffUserId, a.startsAt, a.endsAt],
    );
    return rows[0]!.id;
  } catch (err) {
    if (!(err instanceof pg.DatabaseError)) throw err;
    // 23P01 exclusion_violation: that staff member has an overlapping appointment (also under concurrency)
    if (err.code === '23P01') throw new HttpError(409, 'appointment_slot_taken', 'Khung giờ này đã có lịch.');
    // 23503: customer or staff not in this tenant (composite FKs); don't echo the DB message
    if (err.code === '23503') throw new HttpError(422, 'invalid_reference', 'Khách hàng hoặc nhân viên không hợp lệ.');
    throw err;
  }
}
