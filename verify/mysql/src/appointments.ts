// src/appointments.ts — inside withMember, at READ COMMITTED (the pool's setting). No exclusion constraints:
// serialize per staff member.
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { errno, type TenantDb } from './db/tenant';
import { authorize, ForbiddenError, type Actor } from './shared/authz';
import { HttpError } from './shared/errors';

const MAX_MINUTES = 12 * 60;   // = the CHECK on appointments; bounds the overlap scan

export interface NewAppointment { customerId: string; staffUserId: string; startsAt: Date; endsAt: Date }

export async function bookAppointment(db: TenantDb, actor: Actor, a: NewAppointment): Promise<string> {
  authorize(actor, 'appointment.write');
  if (actor.type === 'user' && actor.role === 'staff' && a.staffUserId !== actor.id) throw new ForbiddenError('appointment.write');
  const minutes = (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000;
  if (!(minutes > 0 && minutes <= MAX_MINUTES)) throw new HttpError(400, 'validation_failed', 'Thời lượng lịch hẹn không hợp lệ.');
  // 1. One booking at a time per staff member: lock their membership row (an existing row: no gap lock)
  const [staff] = await db.conn.query<RowDataPacket[]>(
    'SELECT user_id FROM memberships WHERE tenant_id = ? AND user_id = ? FOR UPDATE', [db.tenantId, a.staffUserId]);
  if (!staff[0]) throw new HttpError(422, 'invalid_reference', 'Khách hàng hoặc nhân viên không hợp lệ.');
  // 2. Overlap check. At READ COMMITTED it reads the booking the previous lock holder just committed; FOR SHARE
  //    keeps a session left at REPEATABLE READ (snapshot older than the lock wait) from double booking.
  const [clash] = await db.conn.query<RowDataPacket[]>(
    `SELECT id FROM appointments
      WHERE tenant_id = ? AND staff_user_id = ? AND starts_at > ? - INTERVAL ? MINUTE AND starts_at < ?
        AND ends_at > ? AND status <> 'cancelled'
      LIMIT 1 FOR SHARE`,
    [db.tenantId, a.staffUserId, a.startsAt, MAX_MINUTES, a.endsAt, a.startsAt]);
  if (clash[0]) throw new HttpError(409, 'appointment_slot_taken', 'Khung giờ này đã có lịch.');
  const id = randomUUID();
  try {
    await db.conn.query(
      `INSERT INTO appointments (tenant_id, id, customer_id, staff_user_id, starts_at, ends_at)
       VALUES (?, ?, ?, ?, ?, ?)`, [db.tenantId, id, a.customerId, a.staffUserId, a.startsAt, a.endsAt]);
  } catch (err) {
    // Customer not in this tenant (composite FK): 1452, or 1216 on 8.0 with database-level grants
    if (errno(err) === 1452 || errno(err) === 1216) throw new HttpError(422, 'invalid_reference', 'Khách hàng hoặc nhân viên không hợp lệ.');
    throw err;
  }
  return id;
}
