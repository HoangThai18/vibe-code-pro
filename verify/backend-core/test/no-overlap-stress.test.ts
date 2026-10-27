// data-layer.md section 6: ten requests booking one slot at the same instant, many rounds.
// STRESS_ROUNDS=500 for the long run; the suite runs 100.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bookAppointment } from '../src/appointments/book';
import { createTenant, withMember, withTenant } from '../src/db/tenant';
import { HttpError } from '../src/shared/errors';
import { errorCode, newAdminPool, newAppPool, reset } from './support/db';

const ROUNDS = Number(process.env.STRESS_ROUNDS ?? 100);
const admin = newAdminPool();
const app = newAppPool();
afterAll(async () => { await Promise.all([admin.end(), app.end()]); });

let A = '', owner = '', staff = '', customer = '';
beforeAll(async () => {
  await reset(admin);
  const ids = await admin.query<{ id: string }>("INSERT INTO users (email) VALUES ('o@x.vn'), ('s@x.vn') RETURNING id");
  [owner, staff] = ids.rows.map((r) => r.id) as [string, string];
  A = await createTenant(app, owner, 'Spa A');
  await withTenant(app, A, async (db) => {
    await db.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'staff')", [A, staff]);
    customer = (await db.query<{ id: string }>("INSERT INTO customers (full_name, phone) VALUES ('Lan', '0912345678') RETURNING id")).rows[0]!.id;
  });
});

// Everyone has opened a transaction and passed the membership check; then all insert at once
function barrier(n: number) {
  let arrived = 0;
  let open!: () => void;
  const all = new Promise<void>((r) => { open = r; });
  return () => { if (++arrived === n) open(); return all; };
}

it(`${ROUNDS} rounds of 10 concurrent bookings of one slot: one booking and nine 409s every time`, async () => {
  const tally: Record<string, number> = {};
  let emptyRounds = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const startsAt = new Date(Date.UTC(2027, 0, 1) + round * 86_400_000);
    const slot = { customerId: customer, staffUserId: staff, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) };
    const ready = barrier(10);
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      withMember(app, A, owner, async (db, actor) => { await ready(); return bookAppointment(db, actor, slot); })
        .then(() => 'ok', (e: unknown) => (e instanceof HttpError ? e.code : errorCode(e) ?? String(e)))));
    for (const r of results) tally[r] = (tally[r] ?? 0) + 1;
    if (!results.includes('ok')) emptyRounds++;
  }
  console.log(`rounds=${ROUNDS} empty=${emptyRounds}`, tally);
  expect(tally).toEqual({ ok: ROUNDS, appointment_slot_taken: 9 * ROUNDS });
}, 120_000);

it('retryOnDeadlock runs the unit once more after 40P01, and gives up after a second one', async () => {
  const { retryOnDeadlock } = await import('../src/db/retry');
  const pg = (await import('pg')).default;
  const deadlock = () => Object.assign(new pg.DatabaseError('deadlock detected', 0, 'error'), { code: '40P01' });
  let calls = 0;
  await expect(retryOnDeadlock(async () => { if (calls++ === 0) throw deadlock(); return 'booked'; })).resolves.toBe('booked');
  calls = 0;
  await expect(retryOnDeadlock(async () => { calls++; throw deadlock(); })).rejects.toMatchObject({ code: '40P01' });
  expect(calls).toBe(2);
  await expect(retryOnDeadlock(async () => { throw new Error('khác'); })).rejects.toThrow('khác');
});
