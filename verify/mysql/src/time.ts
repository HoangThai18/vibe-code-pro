// src/time.ts — "today" in the tenant's zone, computed in the app: no time zone tables needed, and the
// query compares starts_at with two UTC instants, so the (tenant_id, starts_at) index serves it
import type { RowDataPacket } from 'mysql2/promise';
import type { TenantDb } from './db/tenant';

// Offset of a zone at an instant, in ms (Asia/Ho_Chi_Minh: +7 h all year; others change with DST)
function offsetMs(at: Date, timeZone: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - at.getTime();
}

// Local midnight of 'YYYY-MM-DD' in the zone, as a UTC instant
function startOfDay(day: string, timeZone: string): Date {
  const guess = Date.parse(`${day}T00:00:00Z`);
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));   // second pass: the offset at midnight itself
}

export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);   // en-CA prints YYYY-MM-DD
}

export function dayRangeUtc(day: string, timeZone: string): [Date, Date] {
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return [startOfDay(day, timeZone), startOfDay(next, timeZone)];
}

// day: 'YYYY-MM-DD' picked in the UI, or null for today in the tenant's zone
export async function appointmentsOnDay(db: TenantDb, day: string | null) {
  const [[tenant]] = await db.conn.query<RowDataPacket[]>('SELECT time_zone FROM tenants WHERE id = ?', [db.tenantId]);
  const [from, to] = dayRangeUtc(day ?? localDate(new Date(), tenant!.time_zone), tenant!.time_zone);
  const [rows] = await db.conn.query<RowDataPacket[]>(
    `SELECT id, starts_at AS startsAt FROM appointments
      WHERE tenant_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at`, [db.tenantId, from, to]);
  return rows as { id: string; startsAt: Date }[];
}
