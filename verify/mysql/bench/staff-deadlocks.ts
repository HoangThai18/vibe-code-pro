// bench/staff-deadlocks.ts (by hand, after verify.sh's migrate step, before the drop): 10 staff of one tenant book
// the same hour at once, 20 rounds, no retry. Counts 1213 for three versions of the overlap check.
// MYSQL_URL=mysql://root:root@127.0.0.1:3307 VERIFY_DB=verify_mysql node --import tsx bench/staff-deadlocks.ts
import { randomUUID } from 'node:crypto';
import { APP_URL } from '../scripts/env';
import { createAppPool } from '../src/db/pool';
const pool = createAppPool(APP_URL, { connectionLimit: 20 });
const tenant = randomUUID();
const staff = Array.from({ length: 10 }, () => randomUUID());
const owner = randomUUID();
await pool.query('INSERT INTO tenants (id, name) VALUES (?, ?)', [tenant, 'probe']);
await pool.query('INSERT INTO users (id, email) VALUES ?', [[owner, ...staff].map((id) => [id, `${id}@x.vn`])]);
await pool.query('INSERT INTO memberships (tenant_id, user_id, role) VALUES ?', [[owner, ...staff].map((id) => [tenant, id, 'staff'])]);
const cust = randomUUID();
await pool.query("INSERT INTO customers (tenant_id, id, full_name, phone) VALUES (?, ?, 'X', '0912345678')", [tenant, cust]);
// some history for every staff member
for (const s of staff) for (let d = 1; d <= 3; d++) await pool.query('INSERT INTO appointments (tenant_id, id, customer_id, staff_user_id, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)', [tenant, randomUUID(), cust, s, new Date(Date.UTC(2026, 10, d, 3)), new Date(Date.UTC(2026, 10, d, 4))]);
const variants: Record<string, { iso?: string; check: string; force?: boolean }> = {
  'RR, FOR SHARE': { check: 'FOR SHARE' },
  'RR, FOR SHARE, FORCE INDEX': { check: 'FOR SHARE', force: true },
  'RC, plain SELECT': { iso: 'READ COMMITTED', check: '' },
};
let day = 10;
for (const [label, v] of Object.entries(variants)) {
  let deadlocks = 0, ok = 0, other = 0;
  for (let round = 0; round < 20; round++) {
    const startsAt = new Date(Date.UTC(2026, 10, day, 3)), endsAt = new Date(Date.UTC(2026, 10, day++, 4));
    const res = await Promise.allSettled(staff.map(async (s) => {
      const conn = await pool.getConnection();
      try {
        if (v.iso) await conn.query(`SET TRANSACTION ISOLATION LEVEL ${v.iso}`);
        await conn.beginTransaction();
        await conn.query('SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ?', [tenant, owner]);
        await conn.query('SELECT user_id FROM memberships WHERE tenant_id = ? AND user_id = ? FOR UPDATE', [tenant, s]);
        const [c] = await conn.query<any[]>(`SELECT id FROM appointments ${v.force ? 'FORCE INDEX (appointments_staff)' : ''} WHERE tenant_id = ? AND staff_user_id = ? AND starts_at > ? - INTERVAL 720 MINUTE AND starts_at < ? AND ends_at > ? AND status <> 'cancelled' LIMIT 1 ${v.check}`, [tenant, s, startsAt, endsAt, startsAt]);
        if (c.length) throw new Error('clash');
        await conn.query('INSERT INTO appointments (tenant_id, id, customer_id, staff_user_id, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)', [tenant, randomUUID(), cust, s, startsAt, endsAt]);
        await conn.commit();
      } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    }));
    for (const r of res) {
      if (r.status === 'fulfilled') ok++;
      else if ((r.reason as { errno?: number }).errno === 1213) deadlocks++;
      else { other++; console.log((r.reason as Error).message); }
    }
  }
  const [plan] = await pool.query<any[]>("EXPLAIN SELECT id FROM appointments WHERE tenant_id = ? AND staff_user_id = ? AND starts_at > ? - INTERVAL 720 MINUTE AND starts_at < ? AND ends_at > ? AND status <> 'cancelled' LIMIT 1", [tenant, staff[0], new Date(), new Date(), new Date()]);
  console.log(label, { ok, deadlocks, other, key: plan[0].key });
}
await pool.end();
