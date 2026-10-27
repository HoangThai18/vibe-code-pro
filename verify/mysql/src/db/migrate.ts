// src/db/migrate.ts — MySQL commits every DDL statement on its own, so a migration is never atomic:
// record each statement once it ran, and continue after the last recorded one on the next run.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { Connection, RowDataPacket } from 'mysql2/promise';

export interface MigrateOptions { lockWaitSeconds: number; maxTransactionSeconds: number }

export async function migrate(conn: Connection, dir: string,
  opts: MigrateOptions = { lockWaitSeconds: 5, maxTransactionSeconds: 10 }): Promise<number> {
  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(200) NOT NULL, step INT NOT NULL, sha CHAR(64) CHARACTER SET ascii NOT NULL,
    applied_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), PRIMARY KEY (version, step))`);
  // The server default is 31536000 s (one year): an ALTER would wait that long for its metadata lock,
  // and every new query on the table would queue behind it
  await conn.query('SET SESSION lock_wait_timeout = ?', [opts.lockWaitSeconds]);
  let applied = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const statements = readFileSync(`${dir}/${file}`, 'utf8').split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
    const [done] = await conn.query<RowDataPacket[]>('SELECT step, sha FROM schema_migrations WHERE version = ?', [file]);
    for (const [step, sql] of statements.entries()) {
      const sha = createHash('sha256').update(sql).digest('hex');
      const prev = done.find((d) => d.step === step);
      if (prev && prev.sha !== sha) throw new Error(`${file} step ${step} changed after it ran: write a new migration`);
      if (prev) continue;
      await assertNoLongTransactions(conn, opts.maxTransactionSeconds);
      await conn.query(sql);                 // committed now, whatever happens next
      await conn.query('INSERT INTO schema_migrations (version, step, sha) VALUES (?, ?, ?)', [file, step, sha]);
      applied++;
    }
  }
  return applied;
}

// An open transaction holds metadata locks on every table it touched until it ends, even while idle:
// find old ones holding a lock in this database. sys.x$processlist gives the age in picoseconds;
// innodb_trx.trx_started is not converted to the session zone (7 hours off from a +07:00 session).
export async function assertNoLongTransactions(conn: Connection, maxSeconds: number): Promise<void> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT p.conn_id AS id, p.user, p.command, ROUND(p.trx_latency / 1e12) AS seconds, LEFT(p.last_statement, 80) AS lastStatement
       FROM sys.x$processlist p
      WHERE p.trx_state = 'ACTIVE' AND p.trx_latency > ? * 1e12 AND p.conn_id <> CONNECTION_ID()
        AND EXISTS (SELECT 1 FROM performance_schema.metadata_locks m
                     WHERE m.OWNER_THREAD_ID = p.thd_id AND m.OBJECT_SCHEMA = DATABASE())`, [maxSeconds]);
  if (rows.length) throw new Error(`transactions open longer than ${maxSeconds}s: ${JSON.stringify(rows)}`);
}
