// apps/api/src/appointments.ts — ordinary writes: the triggers in realtime.sql emit the events
import type { PoolClient } from 'pg';

export interface Appointment { id: string; customerId: string; staffUserId: string; startsAt: string; status: string; version: number }

const COLUMNS = `id, customer_id AS "customerId", staff_user_id AS "staffUserId", starts_at AS "startsAt", status, version`;

// Used by the reception screen and by the public online-booking page alike
export async function createAppointment(
  db: PoolClient, input: { customerId: string; staffUserId: string; startsAt: string },
): Promise<Appointment> {
  const { rows: [appt] } = await db.query<Appointment>(
    `INSERT INTO appointments (customer_id, staff_user_id, starts_at, ends_at)
     VALUES ($1, $2, $3, $3::timestamptz + interval '1 hour') RETURNING ${COLUMNS}`,
    [input.customerId, input.staffUserId, input.startsAt],
  );
  await db.query(
    "INSERT INTO user_notifications (user_id, kind, appointment_id) VALUES ($1, 'appointment.booked', $2)",
    [input.staffUserId, appt!.id],
  );
  return appt!;
}

export async function cancelAppointment(db: PoolClient, id: string): Promise<Appointment | undefined> {
  const { rows } = await db.query<Appointment>(
    `UPDATE appointments SET status = 'cancelled', version = version + 1 WHERE id = $1 AND status = 'booked' RETURNING ${COLUMNS}`,
    [id],
  );
  return rows[0];
}

export async function listAppointments(db: PoolClient): Promise<Appointment[]> {
  const { rows } = await db.query<Appointment>(`SELECT ${COLUMNS} FROM appointments ORDER BY starts_at, id LIMIT 100`);
  return rows;
}

export async function listNotifications(db: PoolClient, userId: string) {
  const { rows } = await db.query<{ id: string; kind: string; appointmentId: string }>(
    `SELECT id, kind, appointment_id AS "appointmentId" FROM user_notifications
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [userId]);
  return rows;
}
