// bench/staff-deadlocks.ts (by hand, after verify.sh's migrate step, before the drop): 10 staff of one tenant book
// the same hour at once, 20 rounds, no retry, for each isolation level and overlap check; a fresh tenant per run,
// with no history (a new tenant) or 3 appointments per staff member. Counts deadlocks (1213).
// MYSQL_URL=mysql://root:root@127.0.0.1:3307 VERIFY_DB=verify_mysql node --import tsx bench/staff-deadlocks.ts
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { APP_URL } from '../scripts/env';
import { createAppPool } from '../src/db/pool';

const pool = createAppPool(APP_URL, { connectionLimit: 20 });
const variants: { iso: string; check: string; force: boolean }[] = [];
for (const iso of ['REPEATABLE READ', 'READ COMMITTED']) {
  for (const [check, force] of [['FOR SHARE', false], ['FOR SHARE', true], ['', false]] as const) variants.push({ iso, check, force });
}
const { v } = (await pool.query<RowDataPacket[]>('SELECT VERSION() AS v'))[0][0]!;
console.log(`MySQL ${v}`);

for (const history of [false, true]) {
  for (const variant of variants) {
    const tenant = randomUUID(), owner = randomUUID(), cust = randomUUID();
    const staff = Array.from({ length: 10 }, () => randomUUID());
    await pool.query('INSERT INTO tenants (id, name) VALUES (?, ?)', [tenant, 'bench']);
    await pool.query('INSERT INTO users (id, email) VALUES ?', [[owner, ...staff].map((id) => [id, `${id}@x.vn`])]);
    await pool.query('INSERT INTO memberships (tenant_id, user_id, role) VALUES ?', [[owner, ...staff].map((id) => [tenant, id, 'staff'])]);
    await pool.query("INSERT INTO customers (tenant_id, id, full_name, phone) VALUES (?, ?, 'X', '0912345678')", [tenant, cust]);
    for (const s of history ? staff : []) {
      for (let d = 1; d <= 3; d++) {
        await pool.query('INSERT INTO appointments (tenant_id, id, customer_id, staff_user_id, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)',
          [tenant, randomUUID(), cust, s, new Date(Date.UTC(2026, 10, d, 3)), new Date(Date.UTC(2026, 10, d, 4))]);
      }
    }
    let deadlocks = 0, ok = 0, other = 0;
    for (let day = 10; day < 30; day++) {
      const startsAt = new Date(Date.UTC(2026, 10, day, 3)), endsAt = new Date(Date.UTC(2026, 10, day, 4));
      const res = await Promise.allSettled(staff.map(async (s) => {
        const conn = await pool.getConnection();
        try {
          await conn.query(`SET TRANSACTION ISOLATION LEVEL ${variant.iso}`);
          await conn.beginTransaction();
          await conn.query('SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ?', [tenant, owner]);   // withMember
          await conn.query('SELECT user_id FROM memberships WHERE tenant_id = ? AND user_id = ? FOR UPDATE', [tenant, s]);
          const [c] = await conn.query<RowDataPacket[]>(
            `SELECT id FROM appointments ${variant.force ? 'FORCE INDEX (appointments_staff)' : ''}
              WHERE tenant_id = ? AND staff_user_id = ? AND starts_at > ? - INTERVAL 720 MINUTE AND starts_at < ?
                AND ends_at > ? AND status <> 'cancelled' LIMIT 1 ${variant.check}`, [tenant, s, startsAt, endsAt, startsAt]);
          if (c.length) throw new Error('clash');
          await conn.query('INSERT INTO appointments (tenant_id, id, customer_id, staff_user_id, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)',
            [tenant, randomUUID(), cust, s, startsAt, endsAt]);
          await conn.commit();
        } catch (e) {
          await conn.rollback();
          throw e;
        } finally {
          conn.release();
        }
      }));
      for (const r of res) {
        if (r.status === 'fulfilled') ok++;
        else if ((r.reason as { errno?: number }).errno === 1213) deadlocks++;
        else { other++; console.log((r.reason as Error).message); }
      }
    }
    const label = `${history ? 'history' : 'new tenant'}, ${variant.iso}, ${variant.check || 'plain SELECT'}${variant.force ? ', FORCE INDEX' : ''}`;
    console.log(`${label.padEnd(60)} ok ${ok}, deadlocks ${deadlocks}, other ${other}`);
  }
}
await pool.end();
